import { spawn } from "node:child_process";
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
  console.log("────────────────────────────────────────────────────────────────────────────────");

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
    });

    logDebug(`Agent process spawned with PID: ${child.pid}`);
    logDebug(`Using stream-json format for real-time output`);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let resolved = false;
    let stdoutLines = 0;
    let stderrLines = 0;
    let hasOutput = false;

    // Start loading animation
    LoadingSpinner.start("Agent is working...");

    // Need to capture output for logging
    const stdoutStream = child.stdout;
    if (stdoutStream) {
      stdoutStream.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        const newLines = (text.match(/\n/g) || []).length;
        stdoutLines += newLines;

        // Stop loading animation on first output
        if (!hasOutput) {
          hasOutput = true;
          LoadingSpinner.stop(false);
        }

        // Write to stdout immediately
        process.stdout.write(text);
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

        // Write to stderr immediately
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
