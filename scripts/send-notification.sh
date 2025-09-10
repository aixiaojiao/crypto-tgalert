#!/bin/bash

# Telegram通知脚本
# 用法: ./send-notification.sh "消息内容"

if [ $# -eq 0 ]; then
    echo "用法: $0 '消息内容'"
    exit 1
fi

MESSAGE="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 从.env文件读取配置
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -E '^TELEGRAM_BOT_TOKEN=' "$PROJECT_DIR/.env" | xargs)
    export $(grep -E '^TELEGRAM_CHAT_ID=' "$PROJECT_DIR/.env" | xargs)
fi

# 发送Telegram消息
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
        -d chat_id="$TELEGRAM_CHAT_ID" \
        -d text="🤖 [自动部署通知] $MESSAGE" \
        -d parse_mode="HTML" > /dev/null 2>&1
    
    if [ $? -eq 0 ]; then
        echo "✅ 通知发送成功"
    else
        echo "❌ 通知发送失败"
    fi
else
    echo "⚠️  缺少Telegram配置，跳过通知"
fi