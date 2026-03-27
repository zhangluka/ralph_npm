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

// 增加 AbortSignal 的最大监听器数量以避免内存泄漏警告
// devagent 可能会创建多个 AbortSignal，需要更高的限制
setMaxListeners(100);

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
    let hasOutput = false;

    // 启动 loading 动画
    LoadingSpinner.start("Agent is working...");

    const finalize = (payload: Partial<AgentRunResult>) => {
      if (resolved) {
        return;
      }
      resolved = true;

      // 停止 loading 动画
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
      // 停止 loading 动画以显示超时消息
      LoadingSpinner.stop();
      logWarning(`Agent timeout (${options.timeoutMs}ms exceeded), terminating process...`);
      child.kill("SIGTERM");
      setTimeout(() => {
        logError(`Agent did not terminate gracefully, force killing...`);
        child.kill("SIGKILL");
      }, 2000).unref();
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      const newLines = (text.match(/\n/g) || []).length;
      stdoutLines += newLines;

      // 首次输出时停止 loading 动画
      if (!hasOutput) {
        hasOutput = true;
        LoadingSpinner.stop(false);
      }

      // 实时输出，不使用缓冲
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      const newLines = (text.match(/\n/g) || []).length;
      stderrLines += newLines;

      // 首次输出时停止 loading 动画
      if (!hasOutput) {
        hasOutput = true;
        LoadingSpinner.stop(false);
      }

      // 实时输出，不使用缓冲
      process.stderr.write(text);
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
    logInfo(`Prompt sent to agent stdin`);
  });
}
