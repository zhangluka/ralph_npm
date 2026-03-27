import { spawn } from "node:child_process";
import type { AgentRunResult } from "../types.js";
import {
  logDebug,
  logWarning,
  logError,
} from "../reporting/consoleLogger.js";

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

  logDebug(`Agent process starting (attempt ${options.attempt})`);
  logDebug(`Timeout set to ${options.timeoutMs}ms`);

  return await new Promise<AgentRunResult>((resolve) => {
    const child = spawn(options.command, {
      cwd: options.cwd,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PHSPEC_AUTO_APPLY_ATTEMPT: String(options.attempt),
      },
    });

    logDebug(`Agent process spawned with PID: ${child.pid}`);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let resolved = false;
    let stdoutLines = 0;
    let stderrLines = 0;

    const finalize = (payload: Partial<AgentRunResult>) => {
      if (resolved) {
        return;
      }
      resolved = true;
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
      logWarning(`Agent timeout (${options.timeoutMs}ms exceeded), terminating process...`);
      child.kill("SIGTERM");
      setTimeout(() => {
        logError(`Agent did not terminate gracefully, force killing...`);
        child.kill("SIGKILL");
      }, 2000).unref();
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const newLines = (chunk.toString().match(/\n/g) || []).length;
      stdoutLines += newLines;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const newLines = (chunk.toString().match(/\n/g) || []).length;
      stderrLines += newLines;
    });

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
        logWarning(`Agent terminated due to timeout`);
        finalize({ exitCode: code, failureKind: "timeout" });
        return;
      }
      if (code !== 0) {
        logError(`Agent exited with error (exit code: ${code})`);
        finalize({ exitCode: code, failureKind: "agent_error" });
        return;
      }
      logDebug(`Agent exited successfully`);
      finalize({ exitCode: code });
    });

    logDebug(`Writing prompt to agent stdin...`);
    child.stdin.write(options.prompt);
    child.stdin.end();
    logDebug(`Prompt written (${options.prompt.length} characters)`);
  });
}
