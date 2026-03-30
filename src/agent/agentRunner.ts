import { spawn, type ChildProcess } from "node:child_process";
import { setMaxListeners } from "node:events";
import type { AgentRunResult, LogLevel, StreamEvent } from "../types.js";
import {
  logInfo,
  logDebug,
  logWarning,
  logError,
} from "../reporting/consoleLogger.js";
import { LoadingSpinner } from "../utils/loading.js";
import { AgentOutputManager } from "./outputManager.js";

// Increase max listeners to avoid memory leak warnings
// devagent may create many AbortSignals, need very high limit
// Set to Infinity to completely disable this warning
setMaxListeners(Infinity);

export interface RunAgentOptions {
  command: string;
  cwd: string;
  prompt: string;
  timeoutMs: number;
  attempt: number;
  logLevel?: LogLevel;
  changeId?: string;
  maxAttempts?: number;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const startedAt = new Date().toISOString();
  const startTs = Date.now();
  const logLevel = options.logLevel || "normal";

  const outputManager = new AgentOutputManager(logLevel);

  logDebug(`Agent process starting (attempt ${options.attempt})`);
  logDebug(`Timeout set to ${options.timeoutMs}ms`);
  logDebug(`Command: ${options.command}`);
  logDebug(`Prompt length: ${options.prompt.length} characters (${(options.prompt.length / 1024).toFixed(2)} KB)`);

  // Show prompt only in debug mode
  if (logLevel === "debug") {
    logInfo("Prompt sent to agent:");
    console.log("────────────────────────────────────────────────────────────────────────────────");
    console.log(options.prompt);
    console.log("────────────────────────────────────────────────────────────────────────────────");
  }

  outputManager.startSection(
    `Agent Execution: ${options.changeId || "unknown"}`,
    `attempt ${options.attempt}/${options.maxAttempts || 99}`
  );

  return await new Promise<AgentRunResult>((resolve) => {
    // Use stream-json format for real-time streaming output
    // This provides real-time execution progress and logs
    const commandWithFormat = `${options.command} --output-format stream-json --include-partial-messages`;

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
    const eventTypesSeen = new Map<string, number>();
    const eventSamples = new Map<string, any[]>();

    // State tracking for event processing
    let currentTool: string | null = null;
    let inTextBlock = false;
    let streamBuffer = "";

    // Start loading animation
    LoadingSpinner.start("Agent is working...");

    // Event handler function
    const handleEvent = (event: StreamEvent): void => {
      switch (event.type) {
        case "system":
          outputManager.debugSystemInfo(event);
          break;

        case "message":
          handleMessage(event);
          break;

        case "assistant":
          handleAssistant(event);
          break;

        case "user":
          handleUser(event);
          break;

        case "stream_event":
          handleStreamEvent(event);
          break;

        case "result":
          // Final result - handled in finalize
          break;
      }
    };

    const handleMessage = (event: StreamEvent): void => {
      const role = event.message?.role;
      const content = event.message?.content || [];

      if (role === "assistant") {
        handleAssistant(event);
        return;
      }

      if (role === "user") {
        handleUser(event);
        return;
      }
    };

    const handleAssistant = (event: StreamEvent): void => {
      const content = event.message?.content || [];
      for (const msg of content) {
        if (msg.type === "text" && msg.text) {
          outputManager.startStreamText("assistant");
          outputManager.appendStreamText(msg.text);
          outputManager.flushStreamText();
        }
      }
    };

    const handleUser = (event: StreamEvent): void => {
      const content = event.message?.content || [];
      for (const msg of content) {
        if (msg.type === "text" && msg.text) {
          outputManager.startStreamText("user");
          outputManager.appendStreamText(msg.text);
          outputManager.flushStreamText();
        }
      }
    };

    const handleStreamEvent = (event: StreamEvent): void => {
      const inner = event.event;
      if (!inner) return;

      switch (inner.type) {
        case "content_block_start":
          handleContentBlockStart(event);
          break;

        case "content_block_delta":
          handleContentBlockDelta(event);
          break;

        case "content_block_stop":
          handleContentBlockStop();
          break;

        case "message_start":
          // Just a marker, nothing to show
          break;

        case "message_stop":
          // Flush any remaining text
          if (streamBuffer) {
            outputManager.appendStreamText(streamBuffer);
            streamBuffer = "";
          }
          break;
      }
    };

    const handleContentBlockStart = (event: StreamEvent): void => {
      const contentBlock = event.event?.content_block;
      if (!contentBlock) return;

      if (contentBlock.type === "tool_use") {
        const name = contentBlock.name;
        const input = contentBlock.input as Record<string, unknown> | undefined;

        if (name) {
          currentTool = name;
          outputManager.showToolStart(name, input);
        }
      } else if (contentBlock.type === "text") {
        inTextBlock = true;
        outputManager.startStreamText("assistant");
      }
    };

    const handleContentBlockDelta = (event: StreamEvent): void => {
      const delta = event.event?.delta;
      if (!delta) return;

      if (delta.text_delta && inTextBlock) {
        // Accumulate text delta
        streamBuffer += delta.text_delta;

        // Flush when buffer gets large or has newlines
        if (streamBuffer.length > 500 || streamBuffer.includes("\n")) {
          outputManager.appendStreamText(streamBuffer);
          streamBuffer = "";
        }
      }

      // Handle skill progress updates
      if (delta.partial_json) {
        try {
          const data = JSON.parse(delta.partial_json);
          if (data.skill === "phspec-apply-change" && data.progress) {
            const progress = JSON.parse(data.progress || "{}");
            const total = progress.tasks?.total || 0;
            const complete = progress.tasks?.complete || 0;

            if (complete > 0 && logLevel !== "quiet") {
              const percent = Math.round((complete / total) * 100);
              const bar = "█".repeat(Math.floor(percent / 5));
              process.stdout.write(`  Progress: ${complete}/${total} ${percent}% ${bar}\n`);
              (process.stdout as any).flush?.();
            }
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    };

    const handleContentBlockStop = (): void => {
      // Flush remaining buffer
      if (streamBuffer) {
        outputManager.appendStreamText(streamBuffer);
        streamBuffer = "";
      }

      // End current tool or text block
      if (currentTool) {
        const duration = outputManager["activeTools"].get(currentTool);
        if (duration) {
          const elapsed = Date.now() - duration;
          outputManager.showToolResult(currentTool, undefined, elapsed);
        }
        currentTool = null;
      }

      if (inTextBlock) {
        outputManager.flushStreamText();
        inTextBlock = false;
      }
    };

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
            const event = JSON.parse(line) as StreamEvent;
            eventCount++;

            // Track event types for debugging
            const currentCount = (eventTypesSeen.get(event.type) || 0) + 1;
            eventTypesSeen.set(event.type, currentCount);

            // Store first 2 samples of each event type
            const samples = eventSamples.get(event.type) || [];
            if (samples.length < 2) {
              samples.push(event);
              eventSamples.set(event.type, samples);
            }

            // Handle the event using the new event handler
            handleEvent(event);
          } catch (e) {
            // If JSON parse fails, log in debug mode
            if (logLevel === "debug") {
              logDebug(`[STDOUT PARSE ERROR] ${line.slice(0, 100)}`);
            }
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

        // Write stderr immediately and flush
        // Also log for debugging
        process.stderr.write(text);
        (process.stderr as any).flush?.();
        logDebug(`[STDERR] ${text.replace(/\n/g, "\\n")}`);
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

      // Force flush any remaining buffered output
      if (buffer) {
        logDebug(`Flushing remaining buffer: ${buffer.slice(0, 100)}...`);
      }

      // Flush any remaining stream text
      outputManager.flushStreamText();

      // Log event type statistics for debugging
      outputManager.debugEventStats(eventTypesSeen, eventCount);

      // Show first few samples of each event type for debugging
      outputManager.debugEventSamples(eventSamples);

      // End the output section
      const result = payload.failureKind ? "error" : "success";
      outputManager.endSection(result, duration);

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
