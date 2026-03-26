# phspec-auto-apply

一个 npm CLI 工具：扫描项目中的 PhSpec changes，只对已进入 apply 阶段（存在 `tasks.md`）的 change 调用 agent（默认 `devagent --yolo`）自动执行编码。

## PhSpec 自动 Apply（新增）

### 安装依赖

```bash
npm install
```

### 构建

```bash
npm run build
```

### 命令

```bash
# 列出 apply-ready changes
npx phspec-auto-apply list

# 默认执行所有 apply-ready changes
npx phspec-auto-apply run

# 仅分析，不执行
npx phspec-auto-apply run --dry-run

# 指定目录、重试、并发、超时
npx phspec-auto-apply run --changes-dir phspec/changes --retry 2 --concurrency 1 --timeout-ms 1200000

# 查看某次运行报告
npx phspec-auto-apply report <runId>
```

### 运行输出

- 运行状态文件：`.phspec-auto-apply/runs/<runId>.json`
- 每个 change 的日志：`.phspec-auto-apply/logs/<runId>/<change>.log`
- 支持 `--resume <runId>` 从中断点继续执行

---

# devAgentBatch（历史 Bash 方案）

基于 Claude Code (devagent) 的批量代码处理工具。通过配置文件实现自动化批量任务执行，适用于代码分析、批量修复、批量审查等场景。

## 功能特性

- **三种运行模式**: 支持固定 prompt、模板文件、CSV 任务列表
- **灵活的文件扫描**: 支持指定文件后缀、排除目录
- **完整的日志系统**: 任务日志 + 全局日志，支持 Debug 模式
- **变量替换**: 支持 `${file}` 和自定义变量
- **跨平台**: 支持 Linux/macOS 和 Windows

## 快速开始

### 1. 安装依赖

**Linux/macOS:**
```bash
bash setup_linux.sh
```

**Windows:**
```cmd
setup_windows.bat
```

依赖项:
- `yq` - YAML 解析工具
- `devagent` - Claude Code CLI 工具

### 2. 配置任务

编辑 `config.yml` 文件，参考以下配置:

```yaml
# 任务名称
name: "我的批量任务"

# 日志配置
log:
  task_path: ./logs
  path: ./logs/batch.log
  console_flag: true
  debug: false

# 目标文件范围
target:
  directory: "./src"
  include:
    - "java"
    - "xml"
  exclude:
    - "**/target/**"
    - "**/node_modules/**"

# 运行模式
run_mode:
  type: 1  # 1-固定prompt 2-模板文件 3-CSV任务
  prompt: "请分析${file}文件，总结其主要功能"
```

### 3. 运行任务

```bash
# 默认方式
devAgentBatch --config ./config.yml

# 或直接运行脚本
bash devAgentBatch.sh --config ./config.yml
```

## 运行模式详解

### Mode 1: 固定 Prompt

从配置文件中直接读取 prompt，遍历目标目录下的所有文件。

```yaml
run_mode:
  type: 1
  prompt: "请分析${file}文件，总结其主要功能"
```

- `${file}` 变量会被替换为实际文件路径
- 每个文件会执行一次任务

### Mode 2: 模板文件

从外部文件读取 prompt 模板，适用于复杂 prompt。

```yaml
run_mode:
  type: 2
  prompt_template_path: "./prompt_template.txt"
```

prompt_template.txt 内容示例:
```
请总结${file}文件中都有多少个方法
```

### Mode 3: CSV 任务列表

通过 CSV 文件定义批量任务，每行代表一个独立任务。

```yaml
run_mode:
  type: 3
  csv_template_path: "./csv_template.csv"
```

CSV 格式:
```csv
path,prompt,question,recommendations,folder
/d/ideaworkspace/project,目前存在的问题是${question}，给出的建议是${recommendations}，对${folder}文件夹进行修复,没有健康探针,在每个文件中增加探针接口,controller
```

- 第一列 `path`: 工作目录
- 第二列 `prompt`: prompt 模板（支持变量替换）
- 后续列: 自定义变量，通过 `${列名}` 引用

## 配置说明

| 配置项 | 说明 | 必填 |
|--------|------|------|
| `name` | 任务名称 | 是 |
| `log.task_path` | 任务日志目录 | 是 |
| `log.path` | 全局日志文件路径 | 是 |
| `log.console_flag` | 控制台是否打印结果 | 是 |
| `log.debug` | 是否开启 Debug 模式 | 是 |
| `target.directory` | 目标扫描目录 | 是 (mode 1/2) |
| `target.include` | 包含的文件后缀 | 否 |
| `target.exclude` | 排除的目录 | 否 |
| `run_mode.type` | 运行模式 (1/2/3) | 是 |
| `run_mode.prompt` | prompt 内容 (mode 1) | 是 (mode 1) |
| `run_mode.prompt_template_path` | prompt 模板路径 (mode 2) | 是 (mode 2) |
| `run_mode.csv_template_path` | CSV 文件路径 (mode 3) | 是 (mode 3) |

## 项目结构

```
devAgentBatch/
├── devAgentBatch.sh       # 主脚本 (Linux/macOS)
├── config.yml             # 配置文件
├── prompt_template.txt    # prompt 模板示例
├── csv_template.csv       # CSV 任务模板
├── setup_linux.sh         # Linux 安装脚本
├── setup_windows.sh       # Windows 安装脚本
├── uninstall_linux.sh     # Linux 卸载脚本
└── uninstall_windows.sh   # Windows 卸载脚本
```

## 卸载

**Linux/macOS:**
```bash
bash uninstall_linux.sh
```

**Windows:**
```cmd
uninstall_windows.bat
```