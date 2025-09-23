# Docker 云服务器部署指南 - v2.6.9

> 适用于 Ubuntu/CentOS 云服务器的生产环境部署

## 快速部署指南

### 📋 前置要求

- **服务器**: Ubuntu 18.04+ 或 CentOS 7+
- **内存**: 最少 512MB，建议 1GB+
- **磁盘**: 最少 2GB 可用空间
- **网络**: 可访问 GitHub 和 Docker Hub
- **权限**: sudo 权限

### 🚀 一键部署（推荐）

```bash
# 1. 下载并运行一键部署脚本
curl -fsSL https://raw.githubusercontent.com/aixiaojiao/crypto-tgalert/master/deploy-docker.sh -o deploy-docker.sh
chmod +x deploy-docker.sh
sudo ./deploy-docker.sh
```

该脚本会自动：
- 安装 Docker 和 Docker Compose
- 克隆项目到 `/home/ubuntu/crypto-tgalert`
- 创建必要的目录结构
- 设置环境变量模板
- 构建并启动容器

### 🔧 手动部署步骤

#### 步骤 1: 安装 Docker

**Ubuntu:**
```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装依赖
sudo apt install -y apt-transport-https ca-certificates curl gnupg lsb-release

# 添加 Docker GPG 密钥
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# 添加 Docker 仓库
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io

# 启动 Docker 服务
sudo systemctl start docker
sudo systemctl enable docker
```

**CentOS:**
```bash
# 安装依赖
sudo yum install -y yum-utils

# 添加 Docker 仓库
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# 安装 Docker
sudo yum install -y docker-ce docker-ce-cli containerd.io

# 启动 Docker 服务
sudo systemctl start docker
sudo systemctl enable docker
```

#### 步骤 2: 安装 Docker Compose

```bash
# 下载 Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# 添加执行权限
sudo chmod +x /usr/local/bin/docker-compose

# 验证安装
docker-compose --version
```

#### 步骤 3: 部署应用

```bash
# 1. 克隆项目
git clone https://github.com/aixiaojiao/crypto-tgalert.git
cd crypto-tgalert

# 2. 创建环境变量文件
cp .env.example .env

# 3. 编辑环境变量
nano .env
```

**环境变量配置 (.env):**
```bash
# Telegram 配置
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# Binance API 配置
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_secret_key

# 数据库配置
DATABASE_PATH=./data/crypto-tgalert.db

# 运行环境
NODE_ENV=production

# 日志级别 (可选)
LOG_LEVEL=info

# 端口配置 (可选)
PORT=3000
```

#### 步骤 4: 构建和启动

```bash
# 4. 创建数据目录
mkdir -p data logs
sudo chown -R 1001:1001 data logs

# 5. 构建并启动服务
docker-compose up --build -d

# 6. 检查运行状态
docker-compose ps
docker-compose logs -f
```

## 🔄 自动化部署系统

### 设置自动部署

```bash
# 1. 标记使用 Docker 模式
touch USE_DOCKER

# 2. 设置脚本权限
chmod +x scripts/*.sh

# 3. 安装自动部署定时任务
./scripts/setup-cron.sh

# 4. 部署当前版本
./scripts/docker-deploy.sh deploy-v2.6.6
```

### 自动更新流程

1. **标签发布**: 开发者推送 `deploy-v2.x.x` 标签到 GitHub
2. **定时检查**: 每天 UTC+8 凌晨 4 点自动检查新标签
3. **自动部署**: 发现新版本自动下载、构建并部署
4. **健康检查**: 验证新容器运行状态
5. **数据持久化**: 数据库和日志文件保持不变

## 📊 监控和管理

### 查看运行状态

```bash
# 容器状态
docker-compose ps

# 实时日志
docker-compose logs -f

# 容器详细信息
docker inspect crypto-tgalert

# 系统资源使用
docker stats crypto-tgalert
```

### 常用管理命令

```bash
# 重启服务
docker-compose restart

# 停止服务
docker-compose down

# 更新并重启
docker-compose down && docker-compose up --build -d

# 查看部署日志
tail -f logs/deployment.log

# 查看定时任务日志
tail -f logs/cron.log
```

### 数据备份

```bash
# 备份数据库
cp data/crypto-tgalert.db backup/crypto-tgalert-$(date +%Y%m%d).db

# 备份日志
tar -czf backup/logs-$(date +%Y%m%d).tar.gz logs/

# 定期清理
find logs/ -name "*.log" -mtime +30 -delete
```

## 🔧 故障排查

### 常见问题解决

**1. 容器启动失败**
```bash
# 查看详细错误日志
docker-compose logs crypto-tgalert

# 检查配置文件
cat .env

# 重新构建
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

**2. 数据库连接失败**
```bash
# 检查数据目录权限
ls -la data/

# 重置权限
sudo chown -R 1001:1001 data/

# 运行数据库迁移（如果需要）
docker exec -it crypto-tgalert npx ts-node scripts/migrate-yellowlist.ts
```

**3. Telegram 连接问题**
```bash
# 验证 Bot Token
curl -X GET "https://api.telegram.org/bot<YOUR_TOKEN>/getMe"

# 检查防火墙
sudo ufw allow 443
sudo ufw allow 80
```

**4. 内存不足**
```bash
# 检查内存使用
free -h
docker stats

# 优化 Docker 配置（编辑 docker-compose.yml）
deploy:
  resources:
    limits:
      memory: 256M
    reservations:
      memory: 128M
```

### 日志位置

- **应用日志**: `logs/app.log`
- **部署日志**: `logs/deployment.log`
- **定时任务日志**: `logs/cron.log`
- **容器日志**: `docker-compose logs`

## 🔒 安全配置

### 环境变量保护

```bash
# 设置 .env 文件权限
chmod 600 .env

# 确保不被 Git 跟踪
echo ".env" >> .gitignore
```

### 防火墙配置

```bash
# Ubuntu UFW
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 3000  # 如果需要外部访问健康检查

# CentOS Firewalld
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

### SSL/TLS（可选）

如果需要 HTTPS 访问，可以使用 Nginx 反向代理：

```bash
# 安装 Nginx
sudo apt install nginx  # Ubuntu
sudo yum install nginx  # CentOS

# 配置反向代理
sudo nano /etc/nginx/sites-available/crypto-tgalert
```

## 🚀 性能优化

### Docker 优化

```bash
# 清理无用镜像
docker image prune -f

# 清理无用容器
docker container prune -f

# 系统清理
docker system prune -f
```

### 系统优化

```bash
# 增加文件描述符限制
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# 优化内核参数
echo "net.core.somaxconn = 1024" >> /etc/sysctl.conf
sysctl -p
```

## 📈 扩展部署

### 多实例部署

如果需要运行多个实例：

```bash
# 创建多个配置文件
cp docker-compose.yml docker-compose.prod1.yml
cp docker-compose.yml docker-compose.prod2.yml

# 修改端口和容器名
# 启动不同实例
docker-compose -f docker-compose.prod1.yml up -d
docker-compose -f docker-compose.prod2.yml up -d
```

### 负载均衡

使用 Nginx 配置负载均衡：

```nginx
upstream crypto-tgalert {
    server localhost:3000;
    server localhost:3001;
}

server {
    listen 80;
    location / {
        proxy_pass http://crypto-tgalert;
    }
}
```

## 📞 技术支持

- **项目地址**: https://github.com/aixiaojiao/crypto-tgalert
- **问题反馈**: GitHub Issues
- **版本信息**: v2.6.6
- **更新日期**: 2024-09-21

---

**⚡ 部署完成后，机器人应该会自动连接到 Telegram 并开始工作！**