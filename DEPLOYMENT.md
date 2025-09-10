# 自动化部署指南

## 概述

本系统提供完全自动化的部署方案，云服务器每天凌晨4点（UTC+8）自动检查GitHub上的部署标签，如有新版本则自动部署并重启服务。

## 部署架构

### 核心脚本

1. **check-deployment.sh** - 部署检查脚本
   - 检查GitHub最新的deploy-*标签
   - 对比当前部署版本
   - 发现新版本时调用部署脚本

2. **auto-deploy.sh** - 自动部署脚本
   - 创建代码备份
   - 下载最新代码
   - 安装依赖并构建
   - 重启服务
   - 失败时自动回滚

3. **setup-cron.sh** - 定时任务设置脚本
   - 配置每天凌晨4点的定时检查
   - 设置日志记录

### 目录结构

```
/home/ubuntu/crypto-tgalert/
├── scripts/
│   ├── check-deployment.sh      # 部署检查
│   ├── auto-deploy.sh          # 自动部署
│   └── setup-cron.sh          # 定时任务设置
├── logs/
│   ├── deployment.log          # 部署日志
│   └── cron.log               # 定时任务日志
├── .current_deploy_tag         # 当前部署版本记录
└── /crypto-tgalert-backup      # 备份目录
```

## 云服务器初始化

### 1. 部署脚本到服务器

```bash
# 上传项目到云服务器
git clone https://github.com/your-repo/crypto-tgalert.git /home/ubuntu/crypto-tgalert
cd /home/ubuntu/crypto-tgalert

# 安装依赖
npm install

# 设置脚本权限
chmod +x scripts/*.sh
```

### 2. 设置定时任务

```bash
# 运行定时任务设置脚本
./scripts/setup-cron.sh
```

### 3. 验证设置

```bash
# 查看定时任务
crontab -l

# 手动测试部署检查
./scripts/check-deployment.sh

# 查看日志
tail -f logs/deployment.log
```

## 发布新版本

### 1. 本地开发完成后

```bash
# 提交代码
git add .
git commit -m "feat: 新功能实现"
git push origin master

# 创建部署标签
git tag deploy-v2.0.8
git push origin deploy-v2.0.8
```

### 2. 自动部署流程

1. **定时检查**：每天凌晨4点，cron执行`check-deployment.sh`
2. **标签对比**：检查远程最新的`deploy-*`标签
3. **版本判断**：与当前部署版本对比
4. **自动部署**：发现新版本时调用`auto-deploy.sh`
5. **服务重启**：完成后重启PM2服务
6. **状态验证**：检查服务健康状态
7. **失败回滚**：部署失败时自动恢复备份

## 监控和维护

### 查看部署状态

```bash
# 查看当前部署版本
cat /home/ubuntu/crypto-tgalert/.current_deploy_tag

# 查看服务状态
pm2 list

# 查看部署日志
tail -f /home/ubuntu/crypto-tgalert/logs/deployment.log

# 查看定时任务日志
tail -f /home/ubuntu/crypto-tgalert/logs/cron.log
```

### 手动操作

```bash
# 手动检查部署
/home/ubuntu/crypto-tgalert/scripts/check-deployment.sh

# 手动部署指定版本
/home/ubuntu/crypto-tgalert/scripts/auto-deploy.sh deploy-v2.0.8

# 查看可用标签
cd /home/ubuntu/crypto-tgalert
git tag -l "deploy-*"
```

### 故障处理

1. **部署失败**：系统自动回滚到上一版本
2. **服务异常**：检查PM2状态和应用日志
3. **脚本错误**：查看`/home/ubuntu/crypto-tgalert/logs/deployment.log`

## 安全考虑

1. **权限控制**：脚本仅ubuntu用户可执行
2. **备份机制**：每次部署前自动备份
3. **回滚保护**：失败时自动恢复
4. **日志记录**：完整的操作记录
5. **健康检查**：部署后验证服务状态

## 标签命名规范

- **格式**：`deploy-v{major}.{minor}.{patch}`
- **示例**：`deploy-v2.0.8`、`deploy-v2.1.0`
- **注意**：只有以`deploy-`开头的标签会触发部署

## 时间配置

- **检查时间**：每天UTC+8凌晨4点
- **对应UTC**：每天UTC晚上8点（20:00）
- **Cron表达式**：`0 20 * * *`

这套自动化部署系统确保了代码更新的及时性和可靠性，支持无人值守的持续部署。