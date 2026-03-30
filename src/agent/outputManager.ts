import type { LogLevel, StreamEvent, SystemInfo } from "../types.js";

// ANSI color codes
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const DIM = "\x1b[2m";

// Icons
const ICONS = {
  info: `${CYAN}ℹ${RESET}`,
  success: `${GREEN}✓${RESET}`,
  warning: `${YELLOW}⚠${RESET}`,
  error: `${RED}✗${RESET}`,
  robot: `🤖`,
  user: `👤`,
  tool: `🔧`,
  file: `📄`,
  search: `🔍`,
  terminal: `💻`,
};

// Log level priority: higher number = more verbose
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  quiet: 0,
  normal: 1,
  verbose: 2,
  debug: 3,
};

export class AgentOutputManager {
  private logLevel: LogLevel = "normal";
  private streamBuffer = "";
  private streamRole: "assistant" | "user" | null = null;
  private streamStarted = false;
  private activeTools = new Map<string, number>(); // tool name -> start time
  private currentSectionTitle = "";

  constructor(logLevel: LogLevel = "normal") {
    this.logLevel = logLevel;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[this.logLevel] >= LOG_LEVEL_PRIORITY[level];
  }

  private write(text: string): void {
    process.stdout.write(text);
    (process.stdout as any).flush?.();
  }

  private writeLine(text: string): void {
    this.write(text + "\n");
  }

  startSection(title: string, subtitle?: string): void {
    if (!this.shouldLog("normal") && !this.shouldLog("quiet")) {
      return;
    }

    this.currentSectionTitle = title;
    const separator = "═".repeat(76);

    this.writeLine("");
    this.writeLine(separator);
    this.writeLine(`  ${title}${subtitle ? ` (${subtitle})` : ""}`);
    this.writeLine(separator);
    this.writeLine("");
  }

  endSection(result: "success" | "error", duration?: number): void {
    if (!this.shouldLog("normal") && !this.shouldLog("quiet")) {
      return;
    }

    const durationStr = duration ? ` (${(duration / 1000).toFixed(2)}s)` : "";
    const icon = result === "success" ? ICONS.success : ICONS.error;
    const statusText = result === "success" ? "Completed" : "Failed";

    this.writeLine("");
    this.writeLine(`  ${icon} ${statusText}${durationStr}`);
    this.writeLine("");

    // Flush any remaining stream buffer
    this.flushStreamText();

    // Close any remaining tools
    for (const [toolName, startTime] of this.activeTools) {
      const duration = Date.now() - startTime;
      this.showToolResult(toolName, undefined, duration);
    }
    this.activeTools.clear();

    const separator = "═".repeat(76);
    this.writeLine(separator);
    this.writeLine("");
  }

  startStreamText(role: "assistant" | "user"): void {
    this.streamRole = role;
    this.streamBuffer = "";
    this.streamStarted = false;
  }

  appendStreamText(text: string): void {
    if (!this.streamRole) {
      return;
    }

    this.streamBuffer += text;

    // For quiet mode, don't show stream text at all
    if (this.logLevel === "quiet") {
      return;
    }

    // For normal/verbose/debug, accumulate and flush on newlines or buffer size
    const bufferSize = this.streamBuffer.length;

    // Flush when we have a complete line or buffer is too large
    const lastNewlineIndex = this.streamBuffer.lastIndexOf("\n");
    if (lastNewlineIndex >= 0 || bufferSize > 1000) {
      const flushIndex = lastNewlineIndex >= 0 ? lastNewlineIndex + 1 : bufferSize;
      const toFlush = this.streamBuffer.slice(0, flushIndex);

      if (toFlush.trim()) {
        if (!this.streamStarted) {
          this.streamStarted = true;
          const icon = this.streamRole === "assistant" ? ICONS.robot : ICONS.user;
          this.writeLine(`  ${icon} ${this.streamRole?.charAt(0).toUpperCase() + this.streamRole?.slice(1)}:`);
        }

        // Indent the text
        const indented = toFlush
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => `     ${line}`)
          .join("\n");

        this.writeLine(indented);
      }

      this.streamBuffer = this.streamBuffer.slice(flushIndex);
    }
  }

  flushStreamText(): void {
    if (this.streamBuffer && this.streamBuffer.trim() && this.streamRole && this.logLevel !== "quiet") {
      if (!this.streamStarted) {
        const icon = this.streamRole === "assistant" ? ICONS.robot : ICONS.user;
        this.writeLine(`  ${icon} ${this.streamRole.charAt(0).toUpperCase() + this.streamRole.slice(1)}:`);
      }

      const indented = this.streamBuffer
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => `     ${line}`)
        .join("\n");

      this.writeLine(indented);
    }

    this.streamBuffer = "";
    this.streamStarted = false;
    this.streamRole = null;
  }

  showToolStart(toolName: string, params?: Record<string, unknown>): void {
    if (!this.shouldLog("normal")) {
      return;
    }

    this.writeLine("");
    this.writeLine(`  ${ICONS.tool} ${toolName}`);

    if (this.shouldLog("verbose") && params) {
      // Show key parameters in verbose mode
      for (const [key, value] of Object.entries(params)) {
        const valueStr = String(value);
        if (key === "file_path") {
          this.writeLine(`     ${ICONS.file} ${valueStr}`);
        } else if (key === "pattern") {
          this.writeLine(`     ${ICONS.search} ${valueStr}`);
        } else if (key === "command") {
          const truncated = valueStr.length > 80 ? valueStr.slice(0, 80) + "..." : valueStr;
          this.writeLine(`     ${ICONS.terminal} ${truncated}`);
        } else if (key === "file_names" && Array.isArray(value)) {
          this.writeLine(`     ${ICONS.search} ${value.length} file(s)`);
        }
      }
    }

    // Track tool start time
    this.activeTools.set(toolName, Date.now());
  }

  showToolResult(toolName: string, result?: string, duration?: number): void {
    if (!this.shouldLog("normal")) {
      return;
    }

    const startTime = this.activeTools.get(toolName);
    const actualDuration = duration ?? (startTime ? Date.now() - startTime : 0);
    this.activeTools.delete(toolName);

    const durationStr = actualDuration > 0 ? ` (${actualDuration}ms)` : "";

    this.writeLine(`     ${ICONS.success} Completed${durationStr}`);

    // Show detailed result in verbose mode
    if (this.shouldLog("verbose") && result && result.trim()) {
      // Truncate long results
      const truncated = result.length > 200 ? result.slice(0, 200) + "..." : result;
      const indented = truncated
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => `     ${line}`)
        .join("\n");
      this.writeLine(indented);
    }
  }

  showToolError(toolName: string, error: string): void {
    if (!this.shouldLog("normal")) {
      return;
    }

    this.activeTools.delete(toolName);
    this.writeLine(`     ${ICONS.error} ${error}`);
  }

  debugSystemInfo(event: StreamEvent): void {
    if (!this.shouldLog("debug")) {
      return;
    }

    this.writeLine("");
    this.writeLine(`  ${ICONS.tool} ${DIM}DEBUG: System Info${RESET}`);

    const eventAny = event as any;
    if (eventAny.model) {
      this.writeLine(`     Model: ${eventAny.model}`);
    }
    if (event.session_id) {
      this.writeLine(`     Session: ${event.session_id}`);
    }
    if (eventAny.tools && Array.isArray(eventAny.tools)) {
      const toolNames = eventAny.tools.map((t: any) => t.name || t).join(", ");
      this.writeLine(`     Tools: ${toolNames}`);
    }
  }

  debugEventStats(stats: Map<string, number>, totalCount: number): void {
    if (!this.shouldLog("debug") || stats.size === 0) {
      return;
    }

    this.writeLine("");
    this.writeLine(`  ${ICONS.tool} ${DIM}DEBUG: Event Statistics${RESET}`);

    const sorted = Array.from(stats.entries()).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sorted) {
      const percentage = ((count / totalCount) * 100).toFixed(1);
      this.writeLine(`     ${type}: ${count} times (${percentage}%)`);
    }
  }

  debugEventSamples(samples: Map<string, any[]>): void {
    if (!this.shouldLog("debug") || samples.size === 0) {
      return;
    }

    this.writeLine("");
    this.writeLine(`  ${ICONS.tool} ${DIM}DEBUG: Event Type Samples${RESET}`);

    for (const [type, sampleArray] of samples) {
      this.writeLine(`     Type: ${type}`);
      for (let i = 0; i < sampleArray.length; i++) {
        const sampleStr = JSON.stringify(sampleArray[i], null, 2);
        const truncated = sampleStr.length > 300 ? sampleStr.slice(0, 300) + "..." : sampleStr;
        const lines = truncated.split("\n");
        this.writeLine(`       Sample ${i + 1}: ${lines[0]}`);
      }
    }
  }

  showResult(result: string, duration: number): void {
    if (!this.shouldLog("normal")) {
      return;
    }

    this.writeLine("");
    this.writeLine(`  ${ICONS.info} Result: ${result}`);
  }
}
