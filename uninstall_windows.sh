#!/bin/bash

# remove.sh - 移除 devAgentBatch 别名和 yq 环境

ALIAS_NAME="devAgentBatch"
BASHRC_FILE="$HOME/.bashrc"

echo "开始清理环境..."

# 1. 移除别名
if grep -q "alias $ALIAS_NAME=" "$BASHRC_FILE"; then
    sed -i "/alias $ALIAS_NAME=/d" "$BASHRC_FILE"
    echo "✅ 已移除别名 '$ALIAS_NAME'"
else
    echo "ℹ️  未找到别名 '$ALIAS_NAME'"
fi

# 2. 移除 yq 的 PATH 设置 - 使用更简单的模式
if grep -q "export PATH.*yq" "$BASHRC_FILE"; then
    sed -i "/export PATH.*yq/d" "$BASHRC_FILE"
    echo "✅ 已移除 yq 的 PATH 设置"
else
    echo "ℹ️  未找到 yq 的 PATH 设置"
fi

echo ""
echo "清理完成！"
echo "请重新启动 Git Bash 或运行: source ~/.bashrc"