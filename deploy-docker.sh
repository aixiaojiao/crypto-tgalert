#!/bin/bash

# Crypto-TGAlert Docker 一键部署脚本
# 适用于 Ubuntu 服务器

set -e  # 遇到错误立即退出

echo "🚀 开始部署 Crypto-TGAlert Docker 版本..."

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否为 root 用户
if [ "$EUID" -ne 0 ]; then
    log_error "请使用 sudo 运行此脚本"
    exit 1
fi

# 更新系统
log_info "更新系统包..."
apt update && apt upgrade -y

# 安装 Docker
if ! command -v docker &> /dev/null; then
    log_info "安装 Docker..."
    
    # 安装依赖
    apt install -y apt-transport-https ca-certificates curl gnupg lsb-release
    
    # 添加 Docker GPG 密钥
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    
    # 添加 Docker 仓库
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # 更新并安装 Docker
    apt update
    apt install -y docker-ce docker-ce-cli containerd.io
    
    # 启动并启用 Docker 服务
    systemctl start docker
    systemctl enable docker
    
    log_success "Docker 安装完成"
else
    log_info "Docker 已安装，跳过安装步骤"
fi

# 安装 Docker Compose
if ! command -v docker-compose &> /dev/null; then
    log_info "安装 Docker Compose..."
    
    # 下载最新版本的 Docker Compose
    DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep -oP '"tag_name": "\K(.*)(?=")')
    curl -L "https://github.com/docker/compose/releases/download/$DOCKER_COMPOSE_VERSION/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    
    # 添加执行权限
    chmod +x /usr/local/bin/docker-compose
    
    log_success "Docker Compose 安装完成"
else
    log_info "Docker Compose 已安装，跳过安装步骤"
fi

# 检查 .env 文件
if [ ! -f ".env" ]; then
    log_warning ".env 文件不存在"
    
    if [ -f ".env.example" ]; then
        log_info "复制 .env.example 到 .env"
        cp .env.example .env
        log_warning "请编辑 .env 文件并添加你的 API 密钥："
        log_warning "- TELEGRAM_BOT_TOKEN"
        log_warning "- BINANCE_API_KEY"
        log_warning "- BINANCE_API_SECRET"
        echo
        read -p "配置完成后按回车继续..."
    else
        log_error "未找到 .env.example 文件，请手动创建 .env 文件"
        exit 1
    fi
fi

# 创建必要的目录
log_info "创建数据目录..."
mkdir -p data logs
chown -R 1001:1001 data logs

# 构建并启动容器
log_info "构建并启动 Docker 容器..."
docker-compose down 2>/dev/null || true
docker-compose up --build -d

# 等待服务启动
log_info "等待服务启动..."
sleep 10

# 检查容器状态
if docker-compose ps | grep -q "Up"; then
    log_success "部署成功！"
    echo
    log_info "常用命令："
    echo "  查看日志: docker-compose logs -f"
    echo "  停止服务: docker-compose down"
    echo "  重启服务: docker-compose restart"
    echo "  查看状态: docker-compose ps"
    echo
    log_info "数据文件位置："
    echo "  数据库: ./data/"
    echo "  日志: ./logs/"
else
    log_error "部署失败，请检查日志:"
    docker-compose logs
    exit 1
fi

# 设置防火墙（可选）
if command -v ufw &> /dev/null; then
    log_info "配置防火墙..."
    ufw --force enable
    ufw allow ssh
    ufw allow 3000  # 如果需要外部访问健康检查端口
    log_success "防火墙配置完成"
fi

log_success "🎉 Crypto-TGAlert Docker 部署完成！"
log_info "机器人应该已经在运行中，请检查 Telegram 机器人是否响应。"