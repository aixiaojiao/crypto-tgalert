#!/bin/bash

# 自动部署脚本 - 执行实际的代码更新和服务重启
# 使用方法: ./auto-deploy.sh <deploy-tag>

set -e  # 遇到错误立即退出

# 检查参数
if [ $# -ne 1 ]; then
    echo "使用方法: $0 <deploy-tag>"
    echo "例如: $0 deploy-v2.0.7"
    exit 1
fi

DEPLOY_TAG="$1"
REPO_DIR="/home/chala/crypto-tgalert"
LOG_FILE="/home/chala/crypto-tgalert/logs/deployment.log"
BACKUP_DIR="/home/chala/crypto-tgalert-backup"
SERVICE_NAME="crypto-tgalert"  # PM2应用名称
MAX_WAIT_TIME=60  # 服务启动最大等待时间(秒)

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 错误处理函数
error_exit() {
    log "❌ ERROR: $1"
    exit 1
}

# 回滚函数
rollback() {
    log "🔄 开始回滚..."
    if [ -d "$BACKUP_DIR" ]; then
        # 停止当前服务
        if command -v pm2 >/dev/null 2>&1; then
            pm2 stop "$SERVICE_NAME" || true
        else
            pkill -f "crypto-tgalert" || true
        fi
        
        # 恢复备份
        rm -rf "${REPO_DIR}.failed"
        mv "$REPO_DIR" "${REPO_DIR}.failed" || true
        mv "$BACKUP_DIR" "$REPO_DIR" || error_exit "回滚失败：无法恢复备份"
        
        # 重启服务
        cd "$REPO_DIR"
        if command -v pm2 >/dev/null 2>&1; then
            pm2 start ecosystem.config.js || pm2 start npm --name "$SERVICE_NAME" -- start
        else
            log "ℹ️  开发环境：请手动重启服务"
        fi
        
        log "✅ 回滚完成"
        return 0
    else
        error_exit "回滚失败：找不到备份目录"
    fi
}

log "🚀 开始部署: $DEPLOY_TAG"

# 检查项目目录
if [ ! -d "$REPO_DIR" ]; then
    error_exit "项目目录不存在: $REPO_DIR"
fi

cd "$REPO_DIR" || error_exit "无法进入项目目录"

# 1. 创建备份
log "💾 创建代码备份..."
if [ -d "$BACKUP_DIR" ]; then
    rm -rf "$BACKUP_DIR"
fi
cp -r "$REPO_DIR" "$BACKUP_DIR" || error_exit "创建备份失败"

# 2. 获取最新代码并切换到指定标签
log "📥 获取代码: $DEPLOY_TAG"
git fetch --all --tags || error_exit "获取远程代码失败"
git checkout "$DEPLOY_TAG" || error_exit "切换到标签失败: $DEPLOY_TAG"

# 3. 安装/更新依赖
log "📦 安装依赖..."
if ! npm ci; then
    log "⚠️  npm ci失败，尝试npm install..."
    npm install || error_exit "安装依赖失败"
fi

# 4. 构建项目
log "🔨 构建项目..."
npm run build || error_exit "构建项目失败"

# 5. 停止当前服务
log "⏹️  停止当前服务..."
# 在开发环境中，跳过PM2操作
if command -v pm2 >/dev/null 2>&1; then
    if pm2 list | grep -q "$SERVICE_NAME"; then
        pm2 stop "$SERVICE_NAME" || log "⚠️  停止服务时出现警告"
        # 等待服务完全停止
        sleep 3
    else
        log "ℹ️  PM2服务未运行"
    fi
else
    log "ℹ️  开发环境：跳过PM2服务管理"
    # 尝试使用其他方式停止
    pkill -f "crypto-tgalert" || log "ℹ️  未找到需要停止的进程"
fi

# 6. 启动新版本服务
log "🚀 启动新版本服务..."
if command -v pm2 >/dev/null 2>&1; then
    if [ -f "ecosystem.config.js" ]; then
        # 使用PM2配置文件启动
        pm2 start ecosystem.config.js
    elif pm2 list | grep -q "$SERVICE_NAME"; then
        # 重启已存在的PM2应用
        pm2 restart "$SERVICE_NAME"
    else
        # 创建新的PM2应用
        pm2 start npm --name "$SERVICE_NAME" -- start
    fi
else
    log "ℹ️  开发环境：跳过服务启动，请手动启动"
fi

# 7. 等待服务启动并验证
log "⏳ 等待服务启动..."
WAIT_COUNT=0
SERVICE_STARTED=false

if command -v pm2 >/dev/null 2>&1; then
    while [ $WAIT_COUNT -lt $MAX_WAIT_TIME ]; do
        if pm2 list | grep -q "$SERVICE_NAME.*online"; then
            log "✅ 服务启动成功"
            SERVICE_STARTED=true
            break
        fi
        
        sleep 2
        WAIT_COUNT=$((WAIT_COUNT + 2))
        log "⏳ 等待服务启动... (${WAIT_COUNT}s/${MAX_WAIT_TIME}s)"
    done
else
    log "ℹ️  开发环境：跳过服务状态检查"
    SERVICE_STARTED=true
fi

# 8. 验证服务状态
if [ "$SERVICE_STARTED" = false ]; then
    log "❌ 服务启动失败，开始回滚..."
    rollback
    error_exit "部署失败：服务无法启动"
fi

# 9. 额外的健康检查（可选）
log "🏥 执行健康检查..."
sleep 5  # 给服务一些时间完全初始化

# 检查服务是否仍在运行
if command -v pm2 >/dev/null 2>&1; then
    if ! pm2 list | grep -q "$SERVICE_NAME.*online"; then
        log "❌ 健康检查失败：服务已停止，开始回滚..."
        rollback
        error_exit "部署失败：服务健康检查失败"
    fi
else
    log "ℹ️  开发环境：跳过健康检查"
fi

# 10. 清理旧备份
log "🧹 清理备份..."
if [ -d "${BACKUP_DIR}.old" ]; then
    rm -rf "${BACKUP_DIR}.old"
fi

# 保留当前备份作为历史备份
if [ -d "$BACKUP_DIR" ]; then
    mv "$BACKUP_DIR" "${BACKUP_DIR}.old"
fi

# 11. 部署成功
log "🎉 部署成功完成!"
log "📊 服务状态:"
if command -v pm2 >/dev/null 2>&1; then
    pm2 list | grep "$SERVICE_NAME" | tee -a "$LOG_FILE"
else
    log "ℹ️  开发环境：服务管理已跳过"
fi

# 12. 发送部署成功通知（可选，如果有配置Telegram通知）
# 这里可以添加发送Telegram消息的逻辑

log "✅ 部署流程完成: $DEPLOY_TAG"