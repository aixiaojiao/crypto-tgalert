# Crypto TG Alert Bot

一个专业的加密货币期货交易Telegram机器人，专注于期货合约数据分析和实时监控。

## ✨ 主要功能

### 📊 期货数据查询
- **实时价格查询**: 优先显示期货合约价格、资金费率、持仓量数据
- **24h涨跌榜**: 自动过滤已下架代币，显示风险等级图标
- **资金费率排行**: 专注负费率代币，发现套利机会
- **持仓量增长榜**: 支持24h/4h/1h时间维度分析
- **单币OI查询**: `/oi <symbol>` 查询单个代币的持仓变化趋势

### 🛡️ 智能风险管理
- **代币分类系统**: 已下架、黑名单、黄名单智能过滤
- **风险等级显示**: 自动标注高风险代币（⛔⚠️）
- **交易对过滤**: 只显示USDT永续合约，过滤季度合约和USDC交易对

### 🔔 多时间周期报警系统 🆕
- **时间周期支持**: 1m, 5m, 15m, 30m, 1h, 4h, 24h, 3d 八个时间维度
- **报警类型**: 涨幅/跌幅/双向报警，用户自定义阈值
- **实时监控**: WebSocket实时数据驱动，毫秒级响应
- **智能管理**: 完整的报警配置、历史记录和状态管理
- **代币筛选**: 支持单币种监控或全市场监控

### 🤖 用户体验
- **命令菜单**: 左侧菜单栏快速访问所有功能
- **启动通知**: 机器人重启时自动发送通知
- **权限控制**: 仅授权用户可使用

### 🐛 远程调试系统
- **问题记录**: `/debug` 命令远程记录bug和优化建议
- **上下文捕获**: 回复bot消息使用debug命令，自动记录完整上下文
- **智能分析**: `npm run analyze-debug` 分析收集的问题并生成修复建议
- **分类优先级**: 自动对问题分类和优先级排序
- **结构化存储**: Markdown格式存储，便于人工和机器分析

## 🚀 快速开始

### 环境要求
- Node.js >= 16.0.0
- TypeScript >= 4.5.0
- SQLite3

### 安装步骤

1. **克隆项目**
```bash
git clone https://github.com/your-username/crypto-tgalert.git
cd crypto-tgalert
```

2. **安装依赖**
```bash
npm install
```

3. **配置环境变量**
```bash
cp .env.example .env
```

编辑 `.env` 文件，添加必要配置：
```env
# Telegram Bot配置
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_USER_ID=your_user_id_here

# 币安API配置（可选，用于更高请求限制）
BINANCE_API_KEY=your_binance_api_key
BINANCE_SECRET_KEY=your_binance_secret_key

# 应用配置
NODE_ENV=production
LOG_LEVEL=info
```

4. **构建和启动**
```bash
npm run build
npm start
```

### 开发模式
```bash
npm run dev
```

### Debug分析
当收集了debug记录后，可以运行分析脚本：
```bash
npm run analyze-debug
```
这将分析`logs/debug-records.md`中的所有记录，生成智能分析报告和修复建议。

## 📱 可用命令

### 📊 基础查询命令
| 命令 | 功能 | 示例 |
|------|------|------|
| `/price <symbol>` | 查询期货价格+资金费率+持仓量 | `/price btc` |
| `/gainers` | 24小时涨幅榜 TOP10 | |
| `/losers` | 24小时跌幅榜 TOP10 | |
| `/funding` | 负资金费率排行榜 | |
| `/oi24h` | 24小时持仓量增长榜 | |
| `/oi4h` | 4小时持仓量增长榜 | |
| `/oi1h` | 1小时持仓量增长榜 | |
| `/oi <symbol>` | 单个代币OI持仓数据查询 | 显示1h/4h/24h持仓变化 |

### 🔔 多时间周期报警命令 🆕
| 命令 | 功能 | 示例 |
|------|------|------|
| `/add_alert <时间> <类型> <阈值> [币种]` | 添加时间周期报警 | `/add_alert 1h gain 15 btc` |
| `/my_alerts` | 查看我的报警配置 | |
| `/toggle_alert <ID>` | 启用/禁用报警 | `/toggle_alert 1` |
| `/delete_alert <ID>` | 删除报警配置 | `/delete_alert 1` |
| `/alert_history` | 查看报警触发历史 | |

**支持的时间周期**: 1m, 5m, 15m, 30m, 1h, 4h, 24h, 3d
**支持的报警类型**: gain(涨幅), loss(跌幅), both(双向)

### 🛠️ 系统命令
| 命令 | 功能 | 示例 |
|------|------|------|
| `/debug <问题描述>` | 记录bug和优化建议 | `/debug 价格查询太慢` |
| `/status` | 查看系统运行状态 | |
| `/help` | 完整帮助文档 | |

## 🔧 配置文件

### 代币分类配置 (`src/config/tokenLists.ts`)
- **DELISTED_TOKENS**: 已下架代币黑名单
- **BLACKLIST_TOKENS**: 高风险代币黑名单  
- **YELLOWLIST_TOKENS**: 高波动性代币警告名单

可根据市场变化手动维护这些列表。

### 功能特色
- 🎯 **专注期货**: 优先显示期货合约数据而非现货
- 🔍 **智能过滤**: 自动过滤已下架和高风险代币
- 📈 **实时监控**: 支持多时间维度的持仓量变化追踪
- 💡 **负费率挖掘**: 专门显示负资金费率代币，发现套利机会
- 🛡️ **风险提示**: 自动标注代币风险等级

## 🏗️ 项目结构

```
src/
├── bot.ts              # Telegram机器人主逻辑
├── services/
│   ├── binance.ts      # 币安API客户端
│   ├── debugService.ts # Debug记录管理服务
│   └── database.ts     # 数据库服务
├── config/
│   ├── index.ts        # 配置管理
│   └── tokenLists.ts   # 代币分类配置
├── types/              # TypeScript类型定义
├── middleware/         # 中间件
├── utils/              # 工具函数
└── scripts/
    └── analyze-debug.ts # Debug分析脚本
```

## 🔒 安全注意事项

- ✅ 所有敏感信息通过环境变量管理
- ✅ 用户权限验证，仅授权用户可使用
- ✅ API密钥加密存储（如果配置）
- ✅ 数据库文件已添加到.gitignore

**请确保：**
1. 不要将 `.env` 文件提交到代码仓库
2. 定期更换API密钥
3. 仅向可信用户提供机器人访问权限

## 📊 监控和日志

系统提供详细的运行日志：
- API请求响应时间监控
- 错误和异常自动记录
- 用户操作审计日志
- 系统性能指标追踪

## 🤝 贡献指南

1. Fork本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

## 📄 许可证

本项目采用MIT许可证。详见 [LICENSE](LICENSE) 文件。

## ⚡ 性能优化

- 内置请求频率限制器
- 智能缓存机制
- 并发请求优化
- 内存使用监控

## 📞 支持

如遇到问题或需要功能请求，请：
1. 查看 [Issues](https://github.com/your-username/crypto-tgalert/issues)
2. 提交新的Issue描述问题
3. 加入社区讨论

---

⚠️ **风险提示**: 本工具仅供数据分析参考，不构成投资建议。加密货币交易存在高风险，请谨慎决策。