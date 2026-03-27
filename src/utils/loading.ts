/**
 * Loading 动画工具类
 * 用于在长时间操作时显示加载动画
 */
export class LoadingSpinner {
  // Unicode spinner（现代终端）
  private static unicodeSpinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  // ASCII spinner（兼容老版本 Windows CMD）
  private static asciiSpinners = ["|", "/", "-", "\\"];
  private static spinners = LoadingSpinner.isUnicodeSupported() ? LoadingSpinner.unicodeSpinners : LoadingSpinner.asciiSpinners;
  private static frame = 0;
  private static interval: NodeJS.Timeout | null = null;
  private static message = "";

  /**
   * 检测终端是否支持 Unicode
   */
  private static isUnicodeSupported(): boolean {
    // 如果环境变量明确禁用 Unicode
    if (process.env.NO_COLOR || process.env.TERM === "dumb") {
      return false;
    }

    // Windows 环境检测
    if (process.platform === "win32") {
      // Windows Terminal、PowerShell 5+、Git Bash 通常支持 Unicode
      // 老版本 CMD 不支持
      const term = process.env.TERM || "";
      const wtSession = process.env.WT_SESSION; // Windows Terminal 标识
      if (wtSession || term.includes("xterm") || term.includes("screen")) {
        return true;
      }
      // 其他 Windows 终端，保守起见使用 ASCII
      return false;
    }

    // Linux/macOS 环境通常支持 Unicode
    return true;
  }

  /**
   * 获取字符串的显示宽度（考虑 Unicode 字符）
   */
  private static getStringWidth(str: string): number {
    // 简单的宽度估算
    let width = 0;
    for (const char of str) {
      const code = char.codePointAt(0) || 0;
      // Braille 模式字符范围 (U+2800 to U+28FF)
      if (code >= 0x2800 && code <= 0x28FF) {
        width += 1; // 大多数终端中显示为单字符宽度
      } else if (code > 0x7F) {
        // 其他 Unicode 字符（包括中文、emoji 等）通常占 2 列
        // 但这些 spinner 字符在大多数终端中显示为单字符宽度
        width += 1;
      } else {
        width += 1;
      }
    }
    return width;
  }

  /**
   * 开始显示 loading 动画
   * @param message 要显示的消息
   */
  static start(message: string): void {
    this.stop();
    this.message = message;
    this.frame = 0;
    this.interval = setInterval(() => {
      const spinner = this.spinners[this.frame];
      this.frame = (this.frame + 1) % this.spinners.length;
      process.stdout.write(`\r${spinner} ${this.message}`);
    }, 80);
  }

  /**
   * 停止 loading 动画
   * @param newline 是否在停止后换行
   */
  static stop(newline = true): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // 计算需要清除的宽度：spinner (1) + space (1) + message length
    const clearWidth = 1 + 1 + this.getStringWidth(this.message);
    const clearString = " ".repeat(clearWidth);

    if (newline) {
      process.stdout.write(`\r${clearString}\r\n`);
    } else {
      process.stdout.write(`\r${clearString}\r`);
    }
  }

  /**
   * 更新 loading 消息
   * @param message 新的消息
   */
  static update(message: string): void {
    this.message = message;
  }
}

/**
 * 带缓冲的输出器
 * 用于控制输出速率，避免一次性输出过多内容
 */
export class BufferedOutput {
  private buffer: string = "";
  private flushInterval: NodeJS.Timeout | null = null;
  private isPaused = false;
  private readonly stream: NodeJS.WriteStream;
  private readonly flushMs: number;
  private readonly maxChunkSize: number;

  constructor(
    stream: NodeJS.WriteStream,
    options: {
      flushMs?: number;      // 缓冲刷新间隔（毫秒）
      maxChunkSize?: number; // 每次刷新的最大字节数
    } = {},
  ) {
    this.stream = stream;
    this.flushMs = options.flushMs || 50;
    this.maxChunkSize = options.maxChunkSize || 2000;
  }

  /**
   * 写入数据到缓冲区
   * @param chunk 要写入的数据
   */
  write(chunk: string): void {
    if (this.isPaused) {
      // 如果暂停，直接输出
      this.stream.write(chunk);
      return;
    }

    this.buffer += chunk;

    // 如果缓冲区达到最大大小，立即刷新
    if (this.buffer.length >= this.maxChunkSize) {
      this.flush();
    }
  }

  /**
   * 立即刷新缓冲区
   */
  flush(): void {
    if (this.buffer.length > 0) {
      this.stream.write(this.buffer);
      this.buffer = "";
    }
  }

  /**
   * 暂停缓冲，直接输出
   */
  pause(): void {
    this.flush();
    this.isPaused = true;
  }

  /**
   * 恢复缓冲
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * 开始定期刷新
   */
  startFlushing(): void {
    this.stopFlushing();
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.flushMs);
  }

  /**
   * 停止定期刷新
   */
  stopFlushing(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /**
   * 销毁输出器，刷新所有缓冲内容
   */
  destroy(): void {
    this.stopFlushing();
    this.flush();
  }
}
