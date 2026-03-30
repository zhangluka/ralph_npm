import { spawn, type ChildProcess } from "node:child_process";
import { setMaxListeners } from "node:events";
import type { AgentRunResult } from "../types.js";
import {
  logInfo,
  logDebug,
  logWarning,
  logError,
} from "../reporting/consoleLogger.js";
import { LoadingSpinner } from "../utils/loading.js";

// Increase max listeners to avoid memory leak warnings
// devagent may create many AbortSignals, need very high limit
// Set to Infinity to completely disable this warning
setMaxListeners(Infinity);

// Types for devagent stream-event JSON
interface DevAgentStreamEvent {
  type: string;
  uuid: string;
  session_id: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
  event?: {
    type: string;
    [key: string]: unknown;
    message_id?: string;
    parent_tool_use_id?: string;
    text?: string;
    delta?: { partial_json?: string };
    content_block?: {
      type: string;
      name?: string;
      input?: unknown;
    };
  };
}

// Event types we want to show to user
const VISIBLE_EVENT_TYPES = new Set([
  "message",        // Assistant/User messages
  "text_delta",   // Text content from tool output
  "content_block_delta", // Structured tool output
]);

// Event types we want to hide (too verbose)
const HIDDEN_EVENT_TYPES = new Set([
  "system",        // System events (UUIDs, etc)
  "tool_use",      // Tool use tracking
  "stream_event",  // Low-level stream events
]);

// Tool names we want to show
const RELEVANT_TOOLS = new Set([
  "run_shell_command", // Command execution
  "read_file",        // File reading
  "glob",           // File searching
  "edit",            // File editing
  "write_file",       // File writing
]);

/**
 * Check if an event should be visible to users
 */
function shouldShowEvent(event: DevAgentStreamEvent): boolean {
  // Hide system events and tool_use tracking
  if (event.type === "system") return false;
  if (event.type === "tool_use") return false;

  // For assistant messages, check content
  if (event.type === "assistant" && event.message) {
    return true;
  }

  // For stream_event with content_block_delta
  if (event.type === "stream_event" && event.event && event.event.type === "content_block_delta") {
    return true;
  }

  return false;
}

/**
 * Format a stream-event for user display
 */
function formatStreamEvent(streamEvent: DevAgentStreamEvent, eventIndex: number): string | null {
  const { type, event } = streamEvent;

  // Hide verbose events
  if (HIDDEN_EVENT_TYPES.has(type)) {
    return null;
  }

  // Format message events with content
  if (type === "message") {
    const role = streamEvent.message?.role;
    const content = streamEvent.message?.content || [];

    for (const msg of content) {
      if (msg.type === "text" && msg.text) {
        // Use role prefix for better readability
        const prefix = role === "assistant" ? "Assistant" : "User";
        process.stdout.write(prefix + msg.text + "\n");
      }
    }

    return null;
  }

  // Format text_delta (direct text output)
  if (type === "text_delta") {
    const text = event?.text || "";
    if (text && text.trim()) {
      process.stdout.write(text + "\n");
    }
    return null;
  }

  // Format content_block_delta (structured tool output)
  if (type === "stream_event" && event && event.type === "content_block_delta") {
    const delta = event.delta as { partial_json?: string };
    if (delta?.partial_json) {
      try {
        const data = JSON.parse(delta.partial_json);
        if (data.skill === "phspec-apply-change") {
          const progress = JSON.parse(data.progress || "{}");
          const total = progress.tasks?.total || 0;
          const complete = progress.tasks?.complete || 0;

          if (complete > 0) {
            const percent = Math.round((complete / total) * 100);
            const bar = "█".repeat(Math.floor(percent / 5));
            process.stdout.write(`Progress: ${complete}/${total} ${percent}% ${bar}\n`);
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    return null;
  }

  // Format tool_use and content_block_start
  if (type === "stream_event" && event && event.type === "content_block_start") {
    const content_block = event.content_block;
    if (content_block?.type === "tool_use") {
      const { name, input } = content_block;
      if (name && RELEVANT_TOOLS.has(name) && input) {
        process.stdout.write(`Tool: ${name}\n`);
      }
    }
    return null;
  }

  return null;
}

export interface RunAgentOptions {
  command: string;
  cwd: string;
  prompt: string;
  timeoutMs: number;
  attempt: number;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const startedAt = new Date().toISOString();
  const startTs = Date.now();

  logInfo(`Agent process starting (attempt ${options.attempt})`);
  logInfo(`Timeout set to ${options.timeoutMs}ms`);
  logInfo(`Command: ${options.command}`);
  logInfo(`Prompt length: ${options.prompt.length} characters (${(options.prompt.length / 1024).toFixed(2)} KB)`);

  // Output full prompt
  logInfo("Prompt sent to agent:");
  console.log("────────────────────────────────────────────────────────────────────────────────");
  console.log(options.prompt);
  console.log("────────────────────────────────────────────────────────────────────────────────────────────────────────");

  return await new Promise<AgentRunResult>((resolve) => {
    // Use stream-json format for real-time streaming output
    // This provides real-time execution progress and logs
    const commandWithFormat = `${options.command} --format stream-json --include-partial-messages`;

    // Connect to stdout/stderr for real-time output
    // Streams will flush immediately with no buffering
    const child = spawn(commandWithFormat, {
      cwd: options.cwd,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PHSPEC_AUTO_APPLY_ATTEMPT: String(options.attempt),
      },
    }) as ChildProcess;

    logDebug(`Agent process spawned with PID: ${child.pid}`);
    logDebug(`Using stream-json format for real-time output`);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let resolved = false;
    let stdoutLines = 0;
    let stderrLines = 0;
    let hasOutput = false;
    let buffer = "";
    let eventCount = 0;

    // Start loading animation
    LoadingSpinner.start("Agent is working...");

    // Need to capture output for logging
    const stdoutStream = child.stdout;
    if (stdoutStream) {
      stdoutStream.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");

        // Process each complete line
        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line) as DevAgentStreamEvent;
            eventCount++;

            const formatted = formatStreamEvent(event, eventCount);
            if (formatted) {
              process.stdout.write(formatted + "\n");
            }
          } catch {
            // If JSON parse fails, just output line as-is
            process.stdout.write(line + "\n");
          }
        }

        // Keep last incomplete line in buffer
        const lastLineStart = lines[lines.length - 1] || "";
        buffer = lastLineStart;
        stdout += chunk.toString();
        const newLines = (chunk.toString().match(/\n/g) || []).length;
        stdoutLines += newLines;

        // Stop loading animation on first output
        if (!hasOutput) {
          hasOutput = true;
          LoadingSpinner.stop(false);
        }
      });
    }

    const stderrStream = child.stderr;
    if (stderrStream) {
      stderrStream.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        const newLines = (text.match(/\n/g) || []).length;
        stderrLines += newLines;

        // Stop loading animation on first output
        if (!hasOutput) {
          hasOutput = true;
          LoadingSpinner.stop(false);
        }

        // Write stderr immediately
        process.stderr.write(text);
      });
    }

    const finalize = (payload: Partial<AgentRunResult>): void => {
      if (resolved) {
        return;
      }
      resolved = true;

      // Stop loading animation
      LoadingSpinner.stop();

      const finishedAt = new Date().toISOString();
      const duration = Date.now() - startTs;
      logDebug(`Agent process finalized (duration: ${duration}ms, stdout lines: ${stdoutLines}, stderr lines: ${stderrLines})`);
      resolve({
        exitCode: null,
        stdout,
        stderr,
        startedAt,
        finishedAt,
        durationMs: duration,
        timedOut,
        ...payload,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      // Stop loading animation to show timeout message
      LoadingSpinner.stop();
      logWarning(`Agent timeout (${options.timeoutMs}ms exceeded), terminating process...`);
      child.kill("SIGTERM");
      setTimeout(() => {
        logError("Agent did not terminate gracefully, force killing...");
        child.kill("SIGKILL");
      }, 2000).unref();
    }, options.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      logError(`Agent spawn error: ${error.message}`);
      finalize({
        failureKind: "spawn_error",
        stderr: `${stderr}\n${String(error)}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      logDebug(`Agent process closed (exit code: ${code})`);

      if (timedOut) {
        logWarning("Agent terminated due to timeout");
        finalize({ exitCode: code, failureKind: "timeout" });
        return;
      }
      if (code !== 0) {
        logError(`Agent exited with error (exit code: ${code})`);
        finalize({ exitCode: code, failureKind: "agent_error" });
        return;
      }
      logDebug("Agent exited successfully");
      finalize({ exitCode: code });
    });

    logDebug("Writing prompt to agent stdin...");
    const stdinStream = child.stdin;
    if (stdinStream) {
      stdinStream.write(options.prompt);
      stdinStream.end();
    }
    logInfo("Prompt sent to agent stdin");
  });
}
