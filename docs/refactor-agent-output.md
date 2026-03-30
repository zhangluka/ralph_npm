# Agent 日志输出优化计划

## Context

用户反馈 agent 部分的日志输出不够好。基于对实际 stream-json 日志的分析，主要问题包括：

1. **输出方式混乱**：process.stdout.write、console.log、自定义 logger 混用
2. **调试信息过多**：完整 prompt、事件统计、样本信息每次都显示
3. **缺乏视觉层次**：所有输出混在一起，没有清晰的分组
4. **流式输出噪音大**：每个字符都单独一个 event，输出混乱
5. **缺少上下文**：不知道当前在做什么（正在执行的工具、消息状态）
6. **进度不清晰**：进度信息和工具执行信息混在一起

## Stream-JSON 事件结构分析

基于实际日志分析，主要事件类型：

| 事件类型 | 说明 | 是否显示 |
|---------|------|---------|
| `system` | 系统初始化（session_id, tools, model） | debug 模式 |
| `stream_event.message_start` | 消息开始 | 隐藏 |
| `stream_event.content_block_start` | 内容块开始（text/tool_use） | debug 模式 |
| `stream_event.content_block_delta.text_delta` | 文本流式输出 | 累积后显示 |
| `stream_event.content_block_delta.input_json_delta` | 工具参数流式输出 | debug 模式 |
| `stream_event.content_block_stop` | 内容块结束 | 隐藏 |
| `stream_event.message_stop` | 消息结束 | 隐藏 |
| `assistant` | 完整助手消息 | 已通过 text_delta 显示 |
| `user.tool_result` | 工具执行结果 | verbose/debug 模式 |
| `result` | 最终执行结果 | 始终显示 |

## 优化方案

### 核心策略

创建统一的 `AgentOutputManager` 类来管理所有 agent 输出，提供：
- 清晰的视觉层次（分组、缩进、分隔线）
- 可配置的日志级别
- 流式文本累积（避免逐字输出）
- 工具执行跟踪（开始、结束、耗时）
- 进度显示

### 日志级别设计

```
quiet    - 只显示关键信息（成功/失败/错误、最终结果）
normal   - 默认级别，显示主要操作（工具调用、消息摘要）
verbose  - 显示详细日志（工具执行结果）
debug    - 显示所有调试信息（事件统计、样本、系统初始化）
```

### 新的输出格式示例

**NORMAL 模式（默认）**：
```
══════════════════════════════════════════════════════════════════════════
  Agent Execution: expert-auth-free-apply-integration (attempt 1/99)
══════════════════════════════════════════════════════════════════════════

  🤖 Assistant:
     I'll help you apply change for "expert-auth-free-apply-integration".
     Let me first explore current state of PhSpec change and understand what
     needs to be implemented.

  🔧 list_directory
     ✓ Completed (23ms)

  🔧 glob
     ✓ Completed (12ms)

  🤖 Assistant:
     This is a PhSpec change with no errors - Backward Compatibility preserved.
     The feature is ready for testing in development environment.

  ✓ Completed in 597.29s

══════════════════════════════════════════════════════════════════════════
```

**VERBOSE 模式**：
```
... (所有 normal 模式输出)

  🔧 glob
     🔍 **/expert-auth-free-apply-integration*
     ✓ Found 1 matching file(s) (12ms)

  🔧 read_file
     📄 packages/mortgage/src/features/financing-manage/hooks/useExpertAuth.ts
     ✓ Read 45 lines (8ms)
```

**DEBUG 模式**：
```
... (所有 verbose 模式输出)

  🔧 DEBUG: System Info
     Model: deepseek-v3p1
     Session: 5da8cdcb-dcb6-4150-bea3-cbfde53861e3
     Tools: [task, skill, list_directory, read_file, ...]

  🔧 DEBUG: Event Statistics
     stream_event: 45 times (75.0%)
     assistant: 10 times (16.7%)
     user: 5 times (8.3%)
     result: 1 times (1.7%)
```

**QUIET 模式**：
```
✓ expert-auth-free-apply-integration completed (597.29s)
✗ another-change failed: timeout
```

## 实现步骤

### 1. 创建 AgentOutputManager 类

**新建文件**：`src/agent/outputManager.ts`

实现以下核心功能：
```typescript
class AgentOutputManager {
  // 日志级别控制
  setLogLevel(level: 'quiet' | 'normal' | 'verbose' | 'debug')

  // 输出分组（带视觉分隔）
  startSection(title: string, subtitle?: string)
  endSection(result: 'success' | 'error', duration?: number)

  // 流式文本管理（累积后一次性输出）
  startStreamText(role: 'assistant' | 'user')
  appendStreamText(text: string)
  flushStreamText()  // 输出累积的文本

  // 工具执行跟踪
  showToolStart(toolName: string, params?: Record<string, any>)
  showToolResult(toolName: string, result?: string, duration?: number)
  showToolError(toolName: string, error: string)

  // 调试信息
  debugSystemInfo(info: SystemInfo)
  debugEventStats(stats: Map<string, number>)
  debugEventSamples(samples: Map<string, any[]>)

  // 结果输出
  showResult(result: string, duration: number)
}
```

**关键实现细节**：
- **流式文本累积**：将多个 `content_block_delta.text_delta` 累积，遇到换行或超长时才输出
- **工具执行跟踪**：记录工具开始时间，完成时计算耗时
- **视觉层次**：使用缩进（`   `）和图标区分不同类型的信息

### 2. 扩展类型定义

**修改文件**：`src/types.ts`

添加：
```typescript
export type LogLevel = 'quiet' | 'normal' | 'verbose' | 'debug';

export interface RunAgentOptions {
  // ... existing fields
  logLevel?: LogLevel;
  changeId?: string;  // 用于显示 change 名称
}

// Stream JSON 事件类型
interface StreamEvent {
  type: string;
  uuid: string;
  session_id: string;
  event?: {
    type: string;
    content_block?: { type: string; name?: string; input?: unknown };
    delta?: { text_delta?: string; input_json_delta?: string; partial_json?: string };
    message_id?: string;
  };
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
  };
}

interface SystemInfo {
  tools: string[];
  model: string;
  cwd: string;
  session_id: string;
}
```

### 3. 重构 agentRunner.ts

**修改文件**：`src/agent/agentRunner.ts`

主要修改：

1. **导入并创建 OutputManager**：
```typescript
import { AgentOutputManager } from "./outputManager.js";

export async function runAgent(options: RunAgentOptions): Promise<AgentRunResult> {
  const outputManager = new AgentOutputManager(options.logLevel || 'normal');

  outputManager.startSection(
    `Agent Execution: ${options.changeId || 'unknown'}`,
    `attempt ${options.attempt}/${options.maxAttempts || 99}`
  );
```

2. **重构事件处理**：
```typescript
// 使用状态跟踪
let currentTool: string | null = null;
let streamBuffer = '';
let currentRole: 'assistant' | 'user' | null = null;

function handleEvent(event: StreamEvent) {
  switch (event.type) {
    case 'system':
      outputManager.debugSystemInfo(event);
      break;

    case 'stream_event':
      handleStreamEvent(event);
      break;

    case 'assistant':
      handleAssistantMessage(event);
      break;

    case 'result':
      outputManager.showResult(event.result, event.duration_ms);
      break;
  }
}

function handleStreamEvent(event: StreamEvent) {
  const { event: inner } = event;

  switch (inner?.type) {
    case 'content_block_start':
      if (inner.content_block?.type === 'tool_use') {
        const { name, input } = inner.content_block;
        currentTool = name || '';
        outputManager.showToolStart(name, input as Record<string, any>);
      } else if (inner.content_block?.type === 'text') {
        currentRole = 'assistant';
        outputManager.startStreamText('assistant');
      }
      break;

    case 'content_block_delta':
      if (inner.delta?.text_delta) {
        // 累积文本
        streamBuffer += inner.delta.text_delta;
        // 达到阈值或换行时输出
        if (streamBuffer.length > 500 || streamBuffer.includes('\n')) {
          outputManager.appendStreamText(streamBuffer);
          streamBuffer = '';
        }
      }
      break;

    case 'content_block_stop':
      // 输出剩余缓冲区
      if (streamBuffer) {
        outputManager.appendStreamText(streamBuffer);
        streamBuffer = '';
      }
      outputManager.flushStreamText();
      break;
  }
}
```

3. **移除冗余输出**：
```typescript
// 移除完整 prompt 输出（保留到 debug 模式）
if (options.logLevel === 'debug') {
  console.log("────────────────────────────────────────");
  console.log(options.prompt);
  console.log("────────────────────────────────────────");
}

// 移除事件统计和样本（移到 debug 模式）
if (options.logLevel === 'debug') {
  outputManager.debugEventStats(eventTypesSeen);
  outputManager.debugEventSamples(eventSamples);
}
```

### 4. 修改 applyExecutor.ts

**修改文件**：`src/orchestrator/applyExecutor.ts`

添加日志级别支持：
```typescript
export interface ExecuteOptions {
  // ... existing fields
  logLevel?: LogLevel;
}

// 在 runAgent 调用时传递
const result = await runAgent({
  command: options.agentCommand,
  cwd: path.resolve(options.projectRoot),
  prompt,
  timeoutMs: options.timeoutMs,
  attempt,
  logLevel: options.logLevel,
  changeId: change.id,
  maxAttempts: options.retry,
});
```

### 5. 修改 cli.ts

**修改文件**：`src/cli.ts`

添加参数：
```typescript
program
  .command("run")
  .option("--log-level <level>", "log level: quiet|normal|verbose|debug", "normal")
  .option("--debug", "enable debug output (alias for --log-level debug)")
  .action(async (opts) => {
    const logLevel = opts.debug ? 'debug' : (opts.logLevel as LogLevel) || 'normal';
    // ...
    const result = await executeApplyQueue(changes, {
      // ...
      logLevel,
    });
  });
```

## 关键文件

- `src/agent/agentRunner.ts` - 核心 agent 运行逻辑，需要重构输出方式
- `src/agent/outputManager.ts` - 新增文件，统一的输出管理器
- `src/cli.ts` - 添加日志级别参数
- `src/types.ts` - 添加日志级别类型定义和事件类型
- `src/orchestrator/applyExecutor.ts` - 传递日志级别

## 验证方案

1. 测试不同日志级别：
   ```bash
   phspec-auto-apply run --log-level quiet
   phspec-auto-apply run --log-level normal
   phspec-auto-apply run --log-level verbose
   phspec-auto-apply run --debug
   ```

2. 验证点：
   - [ ] QUIET 模式只显示成功/失败摘要
   - [ ] NORMAL 模式显示工具调用和消息
   - [ ] VERBOSE 模式显示工具执行结果
   - [ ] DEBUG 模式显示事件统计和系统信息
   - [ ] 流式文本平滑输出（非逐字输出）
   - [ ] 工具执行带完成时间
   - [ ] 视觉分组清晰（分隔线、缩进）
   - [ ] 向后兼容（不影响现有功能）
