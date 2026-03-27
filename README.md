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

