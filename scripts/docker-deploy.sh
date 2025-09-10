#!/bin/bash

# Docker自动部署脚本 - 用于容器化部署
# 使用方法: ./docker-deploy.sh <deploy-tag>

set -e  # 遇到错误立即退出

# 检查参数
if [ $# -ne 1 ]; then
    echo "使用方法: $0 <deploy-tag>"
    echo "例如: $0 deploy-v2.0.7"
    exit 1
fi

DEPLOY_TAG="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$REPO_DIR/logs/deployment.log"
CONTAINER_NAME="crypto-tgalert"
IMAGE_NAME="crypto-tgalert"
DATA_DIR="$(dirname "$REPO_DIR")/crypto-tgalert-data"  # 持久化数据目录
MAX_WAIT_TIME=60

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 错误处理函数
error_exit() {
    log "❌ ERROR: $1"
    exit 1
}

log "🐳 开始Docker部署: $DEPLOY_TAG"

# 检查项目目录
if [ ! -d "$REPO_DIR" ]; then
    error_exit "项目目录不存在: $REPO_DIR"
fi

cd "$REPO_DIR" || error_exit "无法进入项目目录"

# 1. 获取最新代码并切换到指定标签
log "📥 获取代码: $DEPLOY_TAG"
git fetch --all --tags || error_exit "获取远程代码失败"
git checkout "$DEPLOY_TAG" || error_exit "切换到标签失败: $DEPLOY_TAG"

# 2. 停止并移除现有容器
log "⏹️  停止现有容器..."
if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
    log "停止容器: $CONTAINER_NAME"
    docker stop "$CONTAINER_NAME" || log "⚠️  停止容器时出现警告"
fi

if docker ps -aq -f name="$CONTAINER_NAME" | grep -q .; then
    log "移除容器: $CONTAINER_NAME"
    docker rm "$CONTAINER_NAME" || log "⚠️  移除容器时出现警告"
fi

# 3. 构建新的Docker镜像
log "🔨 构建Docker镜像..."
docker build -t "$IMAGE_NAME:$DEPLOY_TAG" -t "$IMAGE_NAME:latest" . || error_exit "Docker镜像构建失败"

# 4. 创建持久化数据目录
log "📂 准备数据目录..."
mkdir -p "$DATA_DIR/data"
mkdir -p "$DATA_DIR/logs"
mkdir -p "$(dirname "$LOG_FILE")"

# 确保数据目录权限正确（如果不是root用户）
if [ "$(id -u)" != "0" ]; then
    sudo chown -R 1001:1001 "$DATA_DIR" || log "⚠️  设置数据目录权限时出现警告"
else
    chown -R 1001:1001 "$DATA_DIR" 2>/dev/null || log "ℹ️  跳过权限设置（容器会处理）"
fi

# 5. 启动新容器
log "🚀 启动新容器..."

# 检查环境变量文件
ENV_FILE="$REPO_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    log "📋 使用环境变量文件: $ENV_FILE"
    docker run -d \
      --name "$CONTAINER_NAME" \
      --restart unless-stopped \
      -v "$DATA_DIR/data:/app/data" \
      -v "$DATA_DIR/logs:/app/logs" \
      --env-file "$ENV_FILE" \
      -e NODE_ENV=production \
      "$IMAGE_NAME:latest" || error_exit "容器启动失败"
else
    log "⚠️  未找到.env文件，请确保已配置环境变量"
    error_exit "缺少环境变量文件: $ENV_FILE"
fi

# 6. 等待容器启动并验证
log "⏳ 等待容器启动..."
WAIT_COUNT=0
CONTAINER_STARTED=false

while [ $WAIT_COUNT -lt $MAX_WAIT_TIME ]; do
    if docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "$CONTAINER_NAME.*Up"; then
        log "✅ 容器启动成功"
        CONTAINER_STARTED=true
        break
    fi
    
    sleep 2
    WAIT_COUNT=$((WAIT_COUNT + 2))
    log "⏳ 等待容器启动... (${WAIT_COUNT}s/${MAX_WAIT_TIME}s)"
done

# 7. 验证容器状态
if [ "$CONTAINER_STARTED" = false ]; then
    log "❌ 容器启动失败"
    log "📋 容器日志:"
    docker logs "$CONTAINER_NAME" --tail 50 | tee -a "$LOG_FILE"
    error_exit "部署失败：容器无法启动"
fi

# 8. 健康检查
log "🏥 执行健康检查..."
sleep 10  # 给容器一些时间完全初始化

# 检查容器是否仍在运行
if ! docker ps --format "table {{.Names}}\t{{.Status}}" | grep -q "$CONTAINER_NAME.*Up"; then
    log "❌ 健康检查失败：容器已停止"
    log "📋 容器日志:"
    docker logs "$CONTAINER_NAME" --tail 50 | tee -a "$LOG_FILE"
    error_exit "部署失败：容器健康检查失败"
fi

# 9. 清理旧镜像
log "🧹 清理旧镜像..."
OLD_IMAGES=$(docker images "$IMAGE_NAME" --format "{{.Repository}}:{{.Tag}}" | grep -v "latest" | grep -v "$DEPLOY_TAG" | head -3)
if [ -n "$OLD_IMAGES" ]; then
    echo "$OLD_IMAGES" | xargs -r docker rmi || log "⚠️  清理旧镜像时出现警告"
    log "🗑️  已清理旧镜像"
else
    log "ℹ️  没有需要清理的旧镜像"
fi

# 10. 部署成功
log "🎉 Docker部署成功完成!"
log "📊 容器状态:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep "$CONTAINER_NAME" | tee -a "$LOG_FILE"

log "📋 容器信息:"
log "  镜像: $IMAGE_NAME:$DEPLOY_TAG"
log "  数据目录: $DATA_DIR"
log "  日志查看: docker logs $CONTAINER_NAME -f"

log "✅ Docker部署流程完成: $DEPLOY_TAG"