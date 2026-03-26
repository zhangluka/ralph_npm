#!/bin/bash

# remove.sh - 移除 devAgentBatch 别名和 yq 环境

ALIAS_NAME="devAgentBatch"
BASHRC_FILE="$HOME/.bashrc"

echo "开始清理环境..."


# 1. 移除 yq 的 PATH 设置 - 使用更简单的模式
rm /usr/local/bin/yq
echo "✅ 已移除 yq 设置"

# 2. 移除 devAgent 可执行文件
if [ -f "/usr/local/bin/devAgentBatch" ]; then
    rm /usr/local/bin/devAgentBatch
    echo "✅ 已移除 devAgentBatch 命令"
else
    echo "ℹ️  未找到 devAgentBatch 命令"
fi

echo ""
echo "清理完成！"
echo "请重新登录"