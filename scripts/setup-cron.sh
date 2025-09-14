#!/bin/bash

# 设置定时任务脚本 - 配置每天UTC+8凌晨4点执行部署检查
# 使用方法: ./setup-cron.sh

set -e  # 遇到错误立即退出

# 配置变量
CRON_USER=$(whoami)  # 当前用户名
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOY_CHECK_SCRIPT="$PROJECT_DIR/scripts/check-deployment.sh"
CRON_TIME="0 20 * * *"  # UTC时间晚上8点 = UTC+8凌晨4点

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "🔧 开始设置自动部署定时任务..."

# 检查脚本是否存在
if [ ! -f "$DEPLOY_CHECK_SCRIPT" ]; then
    echo "❌ 错误: 部署检查脚本不存在: $DEPLOY_CHECK_SCRIPT"
    echo "请确保已正确部署脚本到云服务器"
    exit 1
fi

# 确保脚本有执行权限
chmod +x "$DEPLOY_CHECK_SCRIPT"
chmod +x "$PROJECT_DIR/scripts/auto-deploy.sh"
chmod +x "$PROJECT_DIR/scripts/docker-deploy.sh"
chmod +x "$PROJECT_DIR/scripts/send-debug-report.sh"

log "📝 配置crontab定时任务..."

# 创建临时crontab文件
TEMP_CRON_FILE="/tmp/crypto-tgalert-cron"

# 获取当前用户的crontab（如果存在）
if crontab -l > /dev/null 2>&1; then
    crontab -l > "$TEMP_CRON_FILE"
else
    # 如果没有现有的crontab，创建空文件
    touch "$TEMP_CRON_FILE"
fi

# 检查是否已存在相同的定时任务
if grep -q "crypto-tgalert.*check-deployment\|crypto-tgalert.*send-debug-report" "$TEMP_CRON_FILE"; then
    log "ℹ️  发现已存在的定时任务，将替换..."
    # 删除旧的任务行
    grep -v "crypto-tgalert.*check-deployment\|crypto-tgalert.*send-debug-report" "$TEMP_CRON_FILE" > "${TEMP_CRON_FILE}.new"
    mv "${TEMP_CRON_FILE}.new" "$TEMP_CRON_FILE"
fi

# 添加新的定时任务
echo "# crypto-tgalert 自动部署检查 - 每天UTC+8凌晨4点执行" >> "$TEMP_CRON_FILE"
echo "$CRON_TIME $DEPLOY_CHECK_SCRIPT >> $PROJECT_DIR/logs/cron.log 2>&1" >> "$TEMP_CRON_FILE"
echo "# crypto-tgalert debug报告发送 - 每天UTC+8早上8点执行" >> "$TEMP_CRON_FILE"
echo "0 0 * * * $PROJECT_DIR/scripts/send-debug-report.sh >> $PROJECT_DIR/logs/cron.log 2>&1" >> "$TEMP_CRON_FILE"

# 应用新的crontab
crontab "$TEMP_CRON_FILE"

# 清理临时文件
rm -f "$TEMP_CRON_FILE"

log "✅ 定时任务设置完成!"
log "📊 当前crontab配置:"
crontab -l | grep -A1 -B1 "crypto-tgalert"

log "📋 任务信息:"
log "   执行时间: 每天UTC+8凌晨4点 (UTC 20:00)"
log "   检查脚本: $DEPLOY_CHECK_SCRIPT"
log "   日志文件: $PROJECT_DIR/logs/cron.log"

log "🎉 自动部署系统配置完成!"
log ""
log "📖 使用说明:"
log "1. 要触发部署，请创建形如 'deploy-v2.0.8' 的Git标签并推送到GitHub"
log "2. 系统将在每天凌晨4点自动检查新标签并部署"
log "3. 可以查看日志: tail -f $PROJECT_DIR/logs/deployment.log"
log "4. 手动执行检查: $DEPLOY_CHECK_SCRIPT"

# 创建日志目录
mkdir -p "$PROJECT_DIR/logs"

log "✅ 设置完成，系统已准备就绪！"