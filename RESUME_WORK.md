# 🔄 快速恢复工作指南

## 📅 上次工作时间：2025-09-09

## 🎯 当前工作状态

### ✅ 已完成的主要功能
- **OI推送通知系统** - 100%完成，已部署运行
- **云服务器部署方案** - 完整配置就绪
- **API优化系统** - 智能分层缓存已实现

### ⏳ 下次需要继续的工作

#### **优先级1: OI推送功能测试** (Issue #13)
```bash
# 1. 检查机器人运行状态
ps aux | grep node

# 2. 查看运行日志
pm2 logs crypto-tgalert

# 3. 启动OI推送测试
# 在Telegram中发送:
/start_oi1h_push
/start_oi4h_push
/start_oi24h_push

# 4. 监控推送触发
tail -f logs/combined.log
```

#### **优先级2: 生产环境部署** (Issue #14)
```bash
# 准备部署的文件都已就绪:
ls -la deploy.sh ecosystem.config.js .env.production DEPLOYMENT.md

# 按照DEPLOYMENT.md执行部署即可
```

## 🏃‍♂️ 5分钟快速启动

```bash
# 1. 进入项目目录
cd /home/chala/crypto-tgalert

# 2. 检查代码是否最新
git status
git pull origin master

# 3. 启动开发环境
npm run build
npm start

# 或使用PM2启动
npm run pm2:start
npm run pm2:logs
```

## 📊 系统当前状态快照

### 机器人信息
- **Bot用户名**: @LatuTVbot
- **授权用户**: 5544890360  
- **总命令数**: 23个
- **数据库**: ./data/crypto-tgalert.db

### 新增OI命令
```
/start_oi1h_push   - 启动OI 1小时推送
/stop_oi1h_push    - 停止OI 1小时推送
/start_oi4h_push   - 启动OI 4小时推送
/stop_oi4h_push    - 停止OI 4小时推送
/start_oi24h_push  - 启动OI 24小时推送
/stop_oi24h_push   - 停止OI 24小时推送
```

### 监控间隔配置
```
OI 1h:  每3分钟检查
OI 4h:  每15分钟检查
OI 24h: 每30分钟检查
```

## 🔧 常用调试命令

```bash
# 查看进程状态
pm2 status

# 实时日志监控
pm2 logs crypto-tgalert --lines 50

# 重启服务
pm2 restart crypto-tgalert

# 系统资源监控
htop

# 数据库查询
sqlite3 data/crypto-tgalert.db ".tables"
sqlite3 data/crypto-tgalert.db "SELECT * FROM oi_rankings LIMIT 10;"

# 查看最新提交
git log --oneline -5
```

## 📱 测试OI推送的步骤

### 1. 验证系统运行
```bash
# 检查机器人是否响应
# 在Telegram发送: /help

# 检查日志是否正常
tail -f logs/combined.log
```

### 2. 启动OI推送
```bash
# 在Telegram中依次发送:
/start_oi1h_push
/start_oi4h_push  
/start_oi24h_push
```

### 3. 监控推送触发
```bash
# 观察日志中的OI检查活动
grep "Checking OI" logs/combined.log

# 等待市场数据变化触发推送
# 通常需要几小时的观察时间
```

## 🚀 生产部署快速启动

### Digital Ocean部署 ($5/月)
```bash
# 1. 购买服务器后SSH登录
ssh root@your-server-ip

# 2. 下载部署脚本
wget https://raw.githubusercontent.com/aixiaojiao/crypto-tgalert/master/deploy.sh
chmod +x deploy.sh
./deploy.sh

# 3. 部署应用
git clone https://github.com/aixiaojiao/crypto-tgalert.git
cd crypto-tgalert
cp .env.production .env
nano .env  # 配置API密钥

# 4. 启动服务
npm install --production
npm run build
npm run pm2:start
pm2 save
```

## 📋 GitHub Issues跟踪

- **Issue #13**: [OI推送功能测试和验证](https://github.com/aixiaojiao/crypto-tgalert/issues/13)
- **Issue #14**: [云服务器生产环境部署](https://github.com/aixiaojiao/crypto-tgalert/issues/14)
- **Issue #12**: [开发进展路线图](https://github.com/aixiaojiao/crypto-tgalert/issues/12)

## ⚡ 紧急问题排查

### 机器人无响应
```bash
pm2 restart crypto-tgalert
pm2 logs crypto-tgalert
```

### API调用失败
```bash
# 检查网络连接
ping api.binance.com

# 检查API密钥配置
grep "BINANCE_API" .env
```

### 内存占用过高
```bash
pm2 restart crypto-tgalert
htop
```

---

**✅ 准备工作完成，可以随时无缝继续开发！**

**下次重点**: 专注测试OI推送功能的实际触发效果 🎯