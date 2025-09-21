# Docker自动化部署完整指南

## 快速开始

### 云服务器升级（适配已有环境）

```bash
# 1. 进入现有项目目录并拉取最新代码
cd /home/ubuntu/crypto-tgalert
git pull origin master

# 2. 设置Docker部署模式
touch USE_DOCKER

# 3. 检查环境变量（如果已有.env文件则跳过）
ls -la .env 2>/dev/null || echo "需要创建.env文件，请参考下面的模板"

# 如果没有.env文件，创建一个（使用你现有的配置值）
# cat > .env << 'EOF'
# TELEGRAM_BOT_TOKEN=你现有的token
# TELEGRAM_CHAT_ID=你现有的chat_id  
# BINANCE_API_KEY=你现有的api_key
# BINANCE_API_SECRET=你现有的secret
# DATABASE_PATH=./data/crypto-tgalert.db
# NODE_ENV=production
# EOF

# 4. 设置权限
chmod +x scripts/*.sh
mkdir -p logs

# 5. 安装并启动定时任务
./scripts/setup-cron.sh

# 6. 立即部署v2.6.6
./scripts/docker-deploy.sh deploy-v2.6.7
```

### 全新安装（如果是新服务器）

```bash
# 1. 克隆项目到云服务器
git clone https://github.com/aixiaojiao/crypto-tgalert.git /home/ubuntu/crypto-tgalert
cd /home/ubuntu/crypto-tgalert

# 2. 设置Docker部署模式
touch USE_DOCKER

# 3. 创建环境变量文件
cat > .env << 'EOF'
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_secret_key
DATABASE_PATH=./data/crypto-tgalert.db
NODE_ENV=production
EOF

# 4. 设置权限并部署
chmod +x scripts/*.sh
mkdir -p logs
./scripts/setup-cron.sh
./scripts/docker-deploy.sh deploy-v2.6.7
```

## 系统架构

### Docker部署流程
1. **定时检查**: 每天UTC+8凌晨4点检查GitHub新标签
2. **自动拉取**: 发现新版本自动拉取最新代码
3. **镜像构建**: 构建新的Docker镜像
4. **容器替换**: 停止旧容器，启动新容器
5. **数据持久化**: 数据库和日志持久化存储
6. **健康检查**: 验证新容器运行状态

### 目录结构
```
/home/ubuntu/
├── crypto-tgalert/                 # 项目代码
│   ├── scripts/
│   │   ├── check-deployment.sh     # 部署检查脚本
│   │   ├── docker-deploy.sh        # Docker部署脚本
│   │   └── setup-cron.sh          # 定时任务设置
│   ├── USE_DOCKER                  # Docker模式标记文件
│   ├── .env                        # 环境变量配置
│   └── logs/deployment.log         # 部署日志
└── crypto-tgalert-data/            # 持久化数据
    ├── data/                       # 数据库文件
    └── logs/                       # 应用日志
```

## 部署新版本

### 本地发布
```bash
# 1. 完成开发工作
git add .
git commit -m "feat: 新功能"
git push origin master

# 2. 创建部署标签
git tag deploy-v2.6.7
git push origin deploy-v2.6.7
```

### 自动部署
- 系统会在次日凌晨4点自动检测并部署新版本
- 无需手动干预

### 手动部署（紧急情况）
```bash
# 登录云服务器
ssh ubuntu@your-server-ip

# 立即部署指定版本
cd /home/ubuntu/crypto-tgalert
./scripts/check-deployment.sh
```

## 监控和管理

### 查看服务状态
```bash
# 查看容器状态
docker ps | grep crypto-tgalert

# 查看容器日志
docker logs crypto-tgalert -f --tail 50

# 查看部署日志
tail -f /home/ubuntu/crypto-tgalert/logs/deployment.log
```

### 手动操作命令
```bash
# 手动停止服务
docker stop crypto-tgalert

# 手动启动服务
docker start crypto-tgalert

# 重启服务
docker restart crypto-tgalert

# 查看当前部署版本
cat /home/ubuntu/crypto-tgalert/.current_deploy_tag

# 查看定时任务
crontab -l
```

### 紧急回滚
```bash
# 查看可用镜像版本
docker images crypto-tgalert

# 回滚到指定版本
docker stop crypto-tgalert
docker rm crypto-tgalert
docker run -d --name crypto-tgalert --restart unless-stopped \
  -v /home/ubuntu/crypto-tgalert-data/data:/app/data \
  -v /home/ubuntu/crypto-tgalert-data/logs:/app/logs \
  --env-file /home/ubuntu/crypto-tgalert/.env \
  crypto-tgalert:deploy-v2.6.5
```

## 故障排查

### 常见问题

1. **容器启动失败**
   ```bash
   # 查看详细日志
   docker logs crypto-tgalert --tail 100
   
   # 检查环境变量
   cat /home/ubuntu/crypto-tgalert/.env
   ```

2. **定时任务未执行**
   ```bash
   # 检查cron服务
   systemctl status cron
   
   # 查看cron日志
   tail -f /var/log/cron.log
   ```

3. **镜像构建失败**
   ```bash
   # 手动构建测试
   cd /home/ubuntu/crypto-tgalert
   docker build -t crypto-tgalert:test .
   ```

4. **数据丢失**
   - 数据持久化在`/home/ubuntu/crypto-tgalert-data/`
   - 容器重建不会影响数据

### 日志位置
- **部署日志**: `/home/ubuntu/crypto-tgalert/logs/deployment.log`
- **应用日志**: `/home/ubuntu/crypto-tgalert-data/logs/`
- **容器日志**: `docker logs crypto-tgalert`
- **定时任务日志**: `/home/ubuntu/crypto-tgalert/logs/cron.log`

## 安全说明

### 环境变量保护
- `.env`文件包含敏感信息，确保权限设置为`600`
- 不要将`.env`文件提交到Git仓库

### 数据备份建议
```bash
# 定期备份数据库
cp /home/ubuntu/crypto-tgalert-data/data/crypto-tgalert.db \
   /home/ubuntu/backup-$(date +%Y%m%d).db

# 定期清理旧镜像
docker image prune -f
```

### 系统监控
- 设置磁盘空间监控
- 定期检查Docker日志大小
- 监控容器内存使用情况

## 性能优化

### Docker优化
- 使用多阶段构建减小镜像大小
- 定期清理unused镜像和容器
- 设置合适的资源限制

### 系统维护
```bash
# 清理Docker系统
docker system prune -f

# 清理旧日志
find /home/ubuntu/crypto-tgalert-data/logs -name "*.log" -mtime +30 -delete
```

这套Docker自动化部署系统提供了完整的生产级解决方案，支持零停机部署和自动回滚机制。