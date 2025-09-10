#!/bin/bash

# 自动部署检查脚本 - 检查GitHub标签并决定是否需要更新
# 使用方法: ./check-deployment.sh

set -e  # 遇到错误立即退出

# 配置变量
REPO_DIR="/home/chala/crypto-tgalert"  # 当前项目目录
LOG_FILE="/home/chala/crypto-tgalert/logs/deployment.log"  # 部署日志
CURRENT_TAG_FILE="/home/chala/crypto-tgalert/.current_deploy_tag"  # 当前部署标签记录
DEPLOY_TAG_PREFIX="deploy-"  # 部署标签前缀

# 创建日志目录
mkdir -p "$(dirname "$LOG_FILE")"

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 错误处理函数
error_exit() {
    log "❌ ERROR: $1"
    exit 1
}

log "🔍 开始检查部署标签..."

# 检查项目目录是否存在
if [ ! -d "$REPO_DIR" ]; then
    error_exit "项目目录不存在: $REPO_DIR"
fi

cd "$REPO_DIR" || error_exit "无法进入项目目录"

# 获取当前已部署的标签
CURRENT_TAG=""
if [ -f "$CURRENT_TAG_FILE" ]; then
    CURRENT_TAG=$(cat "$CURRENT_TAG_FILE")
    log "📋 当前部署标签: $CURRENT_TAG"
else
    log "📋 首次部署检查，无当前标签记录"
fi

# 获取远程最新的部署标签
log "🌐 检查GitHub远程标签..."
git fetch --tags origin || error_exit "无法获取远程标签"

# 查找最新的部署标签 (以deploy-开头，按版本号排序)
LATEST_DEPLOY_TAG=$(git tag -l "${DEPLOY_TAG_PREFIX}*" | sort -V | tail -1)

if [ -z "$LATEST_DEPLOY_TAG" ]; then
    log "ℹ️  未找到部署标签，跳过更新"
    exit 0
fi

log "🏷️  最新部署标签: $LATEST_DEPLOY_TAG"

# 检查是否需要更新
if [ "$CURRENT_TAG" = "$LATEST_DEPLOY_TAG" ]; then
    log "✅ 已是最新版本，无需更新"
    exit 0
fi

log "🚀 发现新版本需要部署: $CURRENT_TAG -> $LATEST_DEPLOY_TAG"

# 执行部署
log "📞 调用部署脚本..."
if /home/chala/crypto-tgalert/scripts/auto-deploy.sh "$LATEST_DEPLOY_TAG"; then
    # 部署成功，更新当前标签记录
    echo "$LATEST_DEPLOY_TAG" > "$CURRENT_TAG_FILE"
    log "✅ 部署成功: $LATEST_DEPLOY_TAG"
else
    error_exit "部署失败: $LATEST_DEPLOY_TAG"
fi

log "🎉 部署检查完成"