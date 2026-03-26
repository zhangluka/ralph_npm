#!/bin/bash

# setup_windows.sh - 自动设置 devAgentBatch 别名和 yq 环境

# 脚本名称
SCRIPT_NAME="devAgentBatch.sh"
ALIAS_NAME="devAgentBatch"
YQ_EXE="yq_windows_amd64.exe"
YQ_INSTALL_DIR="/c/yq"
YQ_TARGET="$YQ_INSTALL_DIR/yq.exe"

# 获取当前目录的绝对路径
CURRENT_DIR="$(pwd -W 2>/dev/null || pwd)"
SCRIPT_PATH="$CURRENT_DIR/$SCRIPT_NAME"

echo "开始设置环境..."

# 1. 检查并设置 yq
echo "步骤 1: 设置 yq..."

# 检查 yq 文件是否存在
if [ ! -f "$CURRENT_DIR/$YQ_EXE" ]; then
    echo "❌ 错误: 在当前目录找不到 $YQ_EXE"
    echo "当前目录: $CURRENT_DIR"
    exit 1
fi

# 创建目标目录
if [ ! -d "$YQ_INSTALL_DIR" ]; then
    echo "创建目录: $YQ_INSTALL_DIR"
    mkdir -p "$YQ_INSTALL_DIR"
fi

# 复制 yq 文件
echo "复制 $YQ_EXE 到 $YQ_TARGET"
cp "$CURRENT_DIR/$YQ_EXE" "$YQ_TARGET"

# 2. 添加 yq 到 PATH
echo "步骤 2: 设置 PATH 环境变量..."

BASHRC_FILE="$HOME/.bashrc"

# 检查 .bashrc 文件是否存在
if [ ! -f "$BASHRC_FILE" ]; then
    echo "创建 .bashrc 文件..."
    touch "$BASHRC_FILE"
fi

# 检查是否已存在 yq 的 PATH 设置
if grep -q "export PATH.*$YQ_INSTALL_DIR" "$BASHRC_FILE"; then
    echo "更新 yq 的 PATH 设置..."
    # 删除已存在的 PATH 设置
    sed -i "/export PATH.*$YQ_INSTALL_DIR/d" "$BASHRC_FILE"
fi

# 添加 yq 到 PATH
echo "添加 $YQ_INSTALL_DIR 到 PATH"
echo "export PATH=\"$YQ_INSTALL_DIR:\$PATH\"" >> "$BASHRC_FILE"

# 3. 设置 devAgentBatch 别名
echo "步骤 3: 设置 devAgentBatch 别名..."

# 检查脚本是否存在
if [ ! -f "$SCRIPT_PATH" ]; then
    echo "❌ 错误: 在当前目录找不到 $SCRIPT_NAME"
    echo "当前目录: $CURRENT_DIR"
    exit 1
fi

# 检查脚本是否有执行权限
if [ ! -x "$SCRIPT_PATH" ]; then
    echo "为脚本添加执行权限..."
    chmod +x "$SCRIPT_PATH"
fi

# 检查是否已存在该别名
if grep -q "alias $ALIAS_NAME=" "$BASHRC_FILE"; then
    echo "更新已存在的别名..."
    # 删除已存在的别名定义
    sed -i "/alias $ALIAS_NAME=/d" "$BASHRC_FILE"
fi

# 添加别名到 .bashrc
echo "添加别名到 .bashrc..."
echo "alias $ALIAS_NAME='$SCRIPT_PATH'" >> "$BASHRC_FILE"

# 立即生效（当前会话）
echo "使设置立即生效..."
source "$BASHRC_FILE"

echo ""
echo "✅ 设置完成！"
echo ""
echo "   脚本设置:"
echo "   - devAgentBatch 别名: $ALIAS_NAME -> $SCRIPT_PATH"
echo ""
echo "   yq 工具设置:"
echo "   - 安装位置: $YQ_TARGET"
echo "   - PATH 添加: $YQ_INSTALL_DIR"
echo ""
echo "   现在你可以在 Git Bash 的任何位置运行:"
echo "   - '$ALIAS_NAME' 来执行主脚本"
echo "   - 'yq' 命令来使用 yq 工具"
echo ""
echo "注意: 新打开的 Git Bash 窗口会自动生效"
echo "测试命令: $ALIAS_NAME 和 yq --version"