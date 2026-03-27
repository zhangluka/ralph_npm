export const LogLevel = {
  INFO: "INFO",
  SUCCESS: "SUCCESS",
  WARNING: "WARNING",
  ERROR: "ERROR",
  DEBUG: "DEBUG",
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export interface ConsoleLogOptions {
  level?: LogLevel;
  timestamp?: boolean;
  indent?: number;
}

const COLORS = {
  INFO: "\x1b[36m",      // Cyan
  SUCCESS: "\x1b[32m",   // Green
  WARNING: "\x1b[33m",   // Yellow
  ERROR: "\x1b[31m",     // Red
  DEBUG: "\x1b[90m",     // Gray
  RESET: "\x1b[0m",
};

const ICONS = {
  INFO: "ℹ",
  SUCCESS: "✓",
  WARNING: "⚠",
  ERROR: "✗",
  DEBUG: "◦",
};

function getTimestamp(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, "0")}`;
}

function formatIndent(count: number): string {
  return "  ".repeat(count);
}

function log(level: LogLevel, message: string, options: ConsoleLogOptions = {}): void {
  const {
    timestamp = true,
    indent = 0,
  } = options;

  const color = COLORS[level];
  const icon = ICONS[level];
  const reset = COLORS.RESET;
  const indentStr = formatIndent(indent);
  const timestampStr = timestamp ? ` [${getTimestamp()}]` : "";

  console.log(`${color}${icon}${timestampStr}${reset} ${indentStr}${message}`);
}

export function logInfo(message: string, options?: Omit<ConsoleLogOptions, "level">): void {
  log(LogLevel.INFO, message, { ...options, level: LogLevel.INFO });
}

export function logSuccess(message: string, options?: Omit<ConsoleLogOptions, "level">): void {
  log(LogLevel.SUCCESS, message, { ...options, level: LogLevel.SUCCESS });
}

export function logWarning(message: string, options?: Omit<ConsoleLogOptions, "level">): void {
  log(LogLevel.WARNING, message, { ...options, level: LogLevel.WARNING });
}

export function logError(message: string, options?: Omit<ConsoleLogOptions, "level">): void {
  log(LogLevel.ERROR, message, { ...options, level: LogLevel.ERROR });
}

export function logDebug(message: string, options?: Omit<ConsoleLogOptions, "level">): void {
  if (process.env.DEBUG === "true") {
    log(LogLevel.DEBUG, message, { ...options, level: LogLevel.DEBUG });
  }
}

export function logSection(title: string): void {
  console.log("");
  console.log(`\x1b[1;36m${"=".repeat(60)}\x1b[0m`);
  console.log(`\x1b[1;36m${title}\x1b[0m`);
  console.log(`\x1b[1;36m${"=".repeat(60)}\x1b[0m`);
}

export function logSubsection(title: string): void {
  console.log("");
  console.log(`\x1b[1;33m${"-".repeat(40)}\x1b[0m`);
  console.log(`\x1b[1;33m${title}\x1b[0m`);
  console.log(`\x1b[1;33m${"-".repeat(40)}\x1b[0m`);
}

export function logCommand(command: string, cwd: string): void {
  logInfo(`Executing command: \x1b[1m${command}\x1b[0m`);
  logDebug(`Working directory: ${cwd}`);
}

export function logTaskStart(taskId: string, taskName: string): void {
  logInfo(`Starting task: \x1b[1m${taskId}\x1b[0m`, { indent: 1 });
  logDebug(`Task description: ${taskName}`, { indent: 2 });
}

export function logTaskProgress(taskId: string, message: string): void {
  logInfo(`${taskId}: ${message}`, { indent: 2 });
}

export function logTaskSuccess(taskId: string, durationMs: number): void {
  const duration = (durationMs / 1000).toFixed(2);
  logSuccess(`${taskId}: Completed in ${duration}s`, { indent: 1 });
}

export function logTaskFailure(taskId: string, error: string, retryCount?: number): void {
  const retryMsg = retryCount ? ` (attempt ${retryCount})` : "";
  logError(`${taskId}: Failed${retryMsg}`, { indent: 1 });
  logDebug(`Error: ${error}`, { indent: 2 });
}

export function logTaskRetry(taskId: string, attempt: number, maxRetries: number): void {
  logWarning(`${taskId}: Retrying (${attempt}/${maxRetries + 1})`, { indent: 2 });
}

export function logSummary(title: string, data: Record<string, unknown>): void {
  logSubsection(title);
  for (const [key, value] of Object.entries(data)) {
    const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    console.log(`  ${key}: ${displayValue}`);
  }
}

export function logAgentOutput(label: string, output: string, maxLength = 200): void {
  if (!output || output.trim() === "") {
    logDebug(`${label}: (empty)`);
    return;
  }

  const trimmed = output.trim();
  if (trimmed.length <= maxLength) {
    logDebug(`${label}: ${trimmed}`);
  } else {
    logDebug(`${label}: ${trimmed.slice(0, maxLength)}... (${trimmed.length} chars total)`);
  }
}

export function logNextStep(message: string): void {
  console.log("");
  logInfo(`Next step: \x1b[1m${message}\x1b[0m`);
}
