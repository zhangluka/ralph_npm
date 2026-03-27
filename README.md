# phspec-auto-apply

一个自动化 PhSpec 变更应用工具。扫描项目中的 PhSpec changes，自动识别已进入 apply 阶段的变更（存在 `tasks.md`），并通过调用 agent（默认 `devagent --yolo`）自动执行编码任务。

## 功能特性

- **自动扫描**：自动识别 `phspec/changes` 目录下的变更
- **智能筛选**：只处理已进入 apply 阶段的变更（存在 `tasks.md`）
- **并发执行**：支持多任务并发处理，提高效率
- **重试机制**：支持失败重试，确保任务成功执行
- **断点续传**：支持从中断点继续执行，避免重复工作
- **实时输出**：实时显示 agent 执行过程，便于监控
- **详细日志**：保存完整的执行日志和状态文件

## 安装

### 局部安装

```bash
npm install
```

局部安装时需要使用 `npx` 运行命令。

### 全局安装

```bash
npm install -g
```

全局安装后可以直接使用命令，无需 `npx`。

## 构建

```bash
npm run build
```

## 使用方法

### 列出可执行的变更

查看所有 `apply-ready` 状态的变更：

```bash
# 局部安装
npx phspec-auto-apply list

# 全局安装
phspec-auto-apply list
```

### 运行自动应用

执行所有 `apply-ready` 状态的变更：

```bash
# 局部安装
npx phspec-auto-apply run

# 全局安装
phspec-auto-apply run
```

### 试运行模式

仅分析变更，不实际执行 agent：

```bash
phspec-auto-apply run --dry-run
```

### 高级选项

指定自定义参数：

```bash
phspec-auto-apply run \
  --changes-dir phspec/changes \  # 变更目录
  --retry 2 \                    # 失败重试次数
  --concurrency 1 \               # 并发数
  --timeout-ms 1200000            # 超时时间（毫秒）
```

### 从断点继续

如果执行中断，可以从上次运行的状态继续：

```bash
phspec-auto-apply run --resume <runId>
```

### 查看运行报告

查看指定运行 ID 的详细报告：

```bash
phspec-auto-apply report <runId>
```

## 输出文件

- **运行状态文件**：`.phspec-auto-apply/runs/<runId>.json` - 保存每次运行的完整状态
- **变更日志文件**：`.phspec-auto-apply/logs/<runId>/<change>.log` - 每个变更的详细执行日志

## 开发

运行测试：

```bash
npm test
```

开发模式运行：

```bash
npm run dev
```
