#!/bin/bash

# 加密货币 Telegram 机器人部署脚本
# 使用方法: ./deploy.sh

set -e

echo "🚀 Starting deployment of Crypto TG Alert Bot..."

# 检查是否为root用户
if [[ $EUID -eq 0 ]]; then
   echo "❌ This script should not be run as root for security reasons"
   exit 1
fi

# 创建必要的目录
echo "📁 Creating directories..."
mkdir -p ~/crypto-tgalert
mkdir -p ~/crypto-tgalert/data
mkdir -p ~/crypto-tgalert/logs
mkdir -p ~/crypto-tgalert/backups

# 更新系统
echo "🔄 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# 安装Node.js 18
echo "📦 Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装PM2进程管理器
echo "⚡ Installing PM2..."
sudo npm install -g pm2

# 安装其他必要工具
echo "🛠️ Installing additional tools..."
sudo apt install -y git curl wget htop nano sqlite3

# 设置防火墙（如果需要）
echo "🔒 Configuring firewall..."
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable

# 创建系统服务用户（可选）
echo "👤 Creating service user..."
if ! id "crypto-bot" &>/dev/null; then
    sudo useradd -r -s /bin/false crypto-bot
fi

echo "✅ Server setup completed!"
echo ""
echo "Next steps:"
echo "1. Upload your project files to ~/crypto-tgalert/"
echo "2. Copy .env.production to .env and configure your API keys"
echo "3. Run: npm install --production"
echo "4. Run: npm run build"
echo "5. Run: pm2 start ecosystem.config.js"
echo ""