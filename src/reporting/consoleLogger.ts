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
  return " ".repeat(count);
}

// Use process.stdout.write for real-time streaming output
// This provides better control than console.log
function writeLog(level: LogLevel, message: string, options: ConsoleLogOptions = {}): void {
  const {
    timestamp = true,
    indent = 0,
  } = options;

  const color = COLORS[level];
  const icon = ICONS[level];
  const reset = COLORS.RESET;
  const indentStr = formatIndent(indent);
  const timestampStr = timestamp ? ` [${getTimestamp()}]` : "";

  // Build the message with color formatting
  const formattedMessage = `${color}${icon}${timestampStr}${reset} ${indentStr}${message}`;

  // Write to stdout and flush immediately
  process.stdout.write(formattedMessage + "\n");
}

export function logInfo(message: string, options?: Omit<ConsoleLogOptions, "level">): void {
  writeLog(LogLevel.INFO, message, { ...options, level: LogLevel.INFO });
}

export function logSuccess(message: string, options?: Omit<ConsoleLogOptions, "level">): void {
  writeLog(LogLevel.SUCCESS, message, { ...options, level: LogLevel.SUCCESS });
}

export function logWarning(message: string, options?: Omit<ConsoleLogOptions, "level">): void {
  writeLog(LogLevel.WARNING, message, { ...options, level: LogLevel.WARNING });
}

export function logError(message: string, options?: Omit<ConsoleLogOptions, "level">): void {
  writeLog(LogLevel.ERROR, message, { ...options, level: LogLevel.ERROR });
}

export function logDebug(message: string, options?: Omit<ConsoleLogOptions, "level">): void {
  if (process.env.DEBUG === "true") {
    writeLog(LogLevel.DEBUG, message, { ...options, level: LogLevel.DEBUG });
  }
}

export function logSection(title: string): void {
  process.stdout.write("\n");
  process.stdout.write(`\x1b[1;36m${"=".repeat(60)}\x1b[0m}\n`);
  process.stdout.write(`\x1b[1;36m${title}\x1b[0m\n`);
  process.stdout.write(`\x1b[1;36m${"=".repeat(60)}\x1b[0m\n`);
}

export function logSubsection(title: string): void {
  process.stdout.write("\n");
  process.stdout.write(`\x1b[1;33m${"-".repeat(40)}\x1b[0m\n`);
  process.stdout.write(`\x1b[1;33m${title}\x1b[0m\n`);
  process.stdout.write(`\x1b[1;33m${"-".repeat(40)}\x1b[0m\n`);
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
    process.stdout.write(`  ${key}: ${displayValue}\n`);
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
  process.stdout.write("\n");
  logInfo(`Next step: \x1b[1m${message}\x1b[0m`);
}
