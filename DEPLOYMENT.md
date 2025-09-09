# 加密货币 Telegram 机器人部署指南

## 服务器推荐配置

### 云服务提供商选择
1. **Digital Ocean** ($5/月) - 推荐新手
2. **Vultr** ($3.5/月) - 性价比高
3. **Linode** ($5/月) - 稳定性好
4. **阿里云/腾讯云** (¥30-50/月) - 国内用户

### 最低硬件要求
```
- OS: Ubuntu 20.04/22.04 LTS
- RAM: 1GB (推荐 2GB)
- CPU: 1 vCPU
- 存储: 25GB SSD
- 网络: 稳定网络连接
```

## 部署步骤

### 1. 服务器初始设置
```bash
# 登录服务器
ssh root@your-server-ip

# 创建新用户（安全考虑）
adduser ubuntu
usermod -aG sudo ubuntu

# 切换到新用户
su - ubuntu

# 下载并运行部署脚本
wget https://raw.githubusercontent.com/your-repo/crypto-tgalert/main/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

### 2. 上传项目文件
```bash
# 方法1: 使用git (推荐)
git clone https://github.com/your-repo/crypto-tgalert.git
cd crypto-tgalert

# 方法2: 使用scp上传
scp -r ./crypto-tgalert ubuntu@your-server-ip:~/
```

### 3. 配置环境变量
```bash
# 复制环境配置文件
cp .env.production .env

# 编辑配置文件
nano .env

# 必需配置项:
# TELEGRAM_BOT_TOKEN=你的机器人token
# AUTHORIZED_USER_ID=你的Telegram用户ID
# BINANCE_API_KEY=币安API密钥
# BINANCE_SECRET_KEY=币安API秘钥
```

### 4. 安装依赖并构建
```bash
# 安装生产依赖
npm install --production

# 构建TypeScript
npm run build

# 验证构建成功
ls -la dist/
```

### 5. 使用PM2启动服务
```bash
# 启动服务
npm run pm2:start

# 查看状态
pm2 status

# 查看日志
npm run pm2:logs

# 监控面板
npm run pm2:monitor
```

### 6. 设置自动启动
```bash
# PM2开机自启
pm2 startup ubuntu
pm2 save
```

## 运维命令

### 常用管理命令
```bash
# 重启服务
npm run pm2:restart

# 停止服务
npm run pm2:stop

# 查看日志
npm run pm2:logs

# 备份数据
npm run backup

# 更新应用
git pull
npm run build
npm run pm2:restart
```

### 监控和维护
```bash
# 系统资源监控
htop

# 磁盘空间检查
df -h

# PM2进程监控
pm2 monit

# 查看机器人状态
pm2 logs crypto-tgalert --lines 50
```

## 安全配置

### 防火墙设置
```bash
# 启用防火墙
sudo ufw enable

# 允许SSH
sudo ufw allow ssh

# 允许HTTP/HTTPS (如需要)
sudo ufw allow 80
sudo ufw allow 443

# 查看状态
sudo ufw status
```

### 定期备份脚本
```bash
# 创建备份脚本
nano ~/backup.sh

#!/bin/bash
cd ~/crypto-tgalert
npm run backup
# 可选: 上传到云存储
# rclone copy backups/ remote:crypto-bot-backups/

# 设置定时备份
crontab -e
# 每天凌晨2点备份
0 2 * * * /home/ubuntu/backup.sh
```

## 故障排除

### 常见问题
1. **机器人无响应**
   ```bash
   pm2 logs crypto-tgalert
   pm2 restart crypto-tgalert
   ```

2. **内存不足**
   ```bash
   free -h
   pm2 restart crypto-tgalert
   ```

3. **API限制**
   - 检查币安API配置
   - 确认网络连接正常

4. **数据库问题**
   ```bash
   sqlite3 data/crypto-tgalert.db ".tables"
   # 备份并重建数据库如需要
   ```

### 日志位置
- 应用日志: `~/crypto-tgalert/logs/`
- PM2日志: `~/.pm2/logs/`
- 系统日志: `/var/log/syslog`

## 性能优化

### 资源监控
```bash
# 安装监控工具
sudo apt install htop iotop nethogs

# 实时监控
htop              # CPU和内存
iotop             # 磁盘IO
nethogs           # 网络流量
```

### 数据库优化
```bash
# 定期清理旧数据
sqlite3 data/crypto-tgalert.db "DELETE FROM gainers_rankings WHERE timestamp < datetime('now', '-7 days');"
sqlite3 data/crypto-tgalert.db "VACUUM;"
```

## 联系支持

如遇到问题，请检查:
1. 日志文件: `npm run pm2:logs`
2. 系统资源: `htop`
3. 网络连接: `ping api.binance.com`
4. API配置: 检查.env文件

---
**注意**: 请妥善保管你的API密钥和配置文件，不要将敏感信息提交到公共代码仓库。