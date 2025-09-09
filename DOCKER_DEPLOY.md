# Docker 一键部署指南

## 🚀 快速部署

### 前置要求

- Ubuntu 18.04/20.04/22.04 服务器
- 具有 sudo 权限的用户
- 网络连接

### 一键部署步骤

1. **登录你的Ubuntu服务器**
   ```bash
   ssh your_user@your_server_ip
   ```

2. **克隆项目到服务器**
   ```bash
   git clone <your_repo_url> crypto-tgalert
   cd crypto-tgalert
   ```

3. **配置环境变量**
   ```bash
   cp .env.example .env
   nano .env  # 编辑配置文件
   ```
   
   **必须配置的项目：**
   - `TELEGRAM_BOT_TOKEN` - 从 @BotFather 获取
   - `TELEGRAM_USER_ID` - 从 @userinfobot 获取
   - `BINANCE_API_KEY` (可选) - 提高API限制
   - `BINANCE_API_SECRET` (可选) - 提高API限制

4. **一键部署**
   ```bash
   sudo ./deploy-docker.sh
   ```

   脚本会自动：
   - 安装 Docker 和 Docker Compose
   - 构建应用镜像
   - 启动容器服务
   - 配置防火墙
   - 创建数据目录

5. **验证部署**
   ```bash
   docker-compose ps     # 查看容器状态
   docker-compose logs   # 查看运行日志
   ```

## 📋 常用管理命令

```bash
# 查看服务状态
docker-compose ps

# 查看实时日志
docker-compose logs -f

# 重启服务
docker-compose restart

# 停止服务
docker-compose down

# 完全重新部署
docker-compose down
docker-compose up --build -d

# 进入容器调试
docker-compose exec crypto-tgalert sh
```

## 🔧 配置说明

### 环境变量配置

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Telegram 机器人令牌 |
| `TELEGRAM_USER_ID` | ✅ | 你的 Telegram 用户 ID |
| `BINANCE_API_KEY` | ⚠️ | Binance API 密钥（可选，但推荐） |
| `BINANCE_API_SECRET` | ⚠️ | Binance API 密钥（可选，但推荐） |
| `NODE_ENV` | ✅ | 运行环境（production） |

### 数据持久化

- **数据库**: `./data/crypto-tgalert.db`
- **日志文件**: `./logs/`
- **配置文件**: `./.env`

### 端口配置

- **应用端口**: 3000 (用于健康检查)
- **外部访问**: 默认不开放，仅内部使用

## 🛠️ 故障排除

### 常见问题

1. **容器启动失败**
   ```bash
   docker-compose logs  # 查看详细错误信息
   ```

2. **机器人不响应**
   - 检查 `TELEGRAM_BOT_TOKEN` 是否正确
   - 确认 `TELEGRAM_USER_ID` 配置正确
   - 查看容器日志确认连接状态

3. **API 限制问题**
   - 配置 Binance API 密钥获得更高限制
   - 检查网络连接到 Binance API

4. **数据库问题**
   ```bash
   # 重置数据库
   docker-compose down
   sudo rm -rf data/
   docker-compose up -d
   ```

### 日志位置

```bash
# 容器日志
docker-compose logs crypto-tgalert

# 应用日志文件
tail -f logs/app.log
tail -f logs/error.log
```

## 🔒 安全建议

1. **防火墙配置**
   - 脚本自动配置 UFW 防火墙
   - 只开放必要端口 (SSH + 3000)

2. **API 密钥安全**
   - 不要将 `.env` 文件提交到版本控制
   - 使用只读权限的 Binance API 密钥
   - 定期轮换 API 密钥

3. **系统更新**
   ```bash
   sudo apt update && sudo apt upgrade -y
   docker-compose pull  # 更新基础镜像
   ```

## 📊 性能监控

```bash
# 系统资源使用
docker stats crypto-tgalert

# 内存和CPU使用情况
htop

# 磁盘使用
df -h
du -sh data/ logs/
```

## 🆙 升级步骤

```bash
# 1. 备份数据
cp -r data/ data_backup_$(date +%Y%m%d)

# 2. 拉取最新代码
git pull origin main

# 3. 重新构建和部署
docker-compose down
docker-compose up --build -d

# 4. 验证升级
docker-compose logs -f
```

## 📞 支持

如果遇到问题，请检查：
1. 容器日志：`docker-compose logs`
2. 系统日志：`journalctl -u docker`
3. 网络连接：`ping api.binance.com`

---

**相比传统部署的优势：**
- ✅ 一键安装，无需手动配置依赖
- ✅ 环境隔离，不影响系统其他服务
- ✅ 自动重启，服务更稳定
- ✅ 资源限制，防止内存泄露
- ✅ 简单升级，数据持久化
- ✅ 统一环境，减少部署差异