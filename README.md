# Crypto TG Alert Bot

一个聚焦币安 U 本位永续合约的 Telegram 机器人：实时行情、多维度告警、ESP32 语音播报、过滤器与点评系统。

当前版本: **v2.8.0**

---

## ✨ 核心能力

### 📊 行情查询
- **/price `<symbol>`** — 期货价格 + 资金费率 + 24h 持仓量
- **/signals `<symbol>`** — 基于价格动量 + 成交量的基础技术信号
- **/rank_gainers**, **/rank_losers** — 多周期涨跌榜（1h/4h/24h …）
- **/funding** — 负费率排行（套利/情绪参考）
- **/oi_1h**, **/oi_4h**, **/oi_24h** — 持仓量增长榜
- **/oi `<symbol>`** — 单币 OI 变化
- **/high `<symbol> <tf>`**, **/near_high** — 历史高点 / 接近高点

### ⚡ 告警系统
- **价格告警** (`/alert`) — `/alert btc > 50000`、`/alert eth < 3000`、`/alert doge change 5%`
- **急涨急跌告警** (`/alert_<tf>_<dir>_<pct>_<sym>`) — 例 `/alert_5m_gain_3_all`
- **突破告警** (`/alert_bt`) — 7d/30d/180d/52w/ATH 五档时间框架，由 SQLite 高点缓存驱动
- **潜力币信号** (`/potential*`) — 24h 价格↑ + OI↑ + Funding 负/松动，分 L1/L2/L3 等级
- **费率告警** (`/funding_alert_*`) — 负费率 (-0.05% / -0.5% / -1% / -1.5%) + 结算周期边沿 (4h/1h)
- **排行榜实时推送** — 进入/离开涨跌榜自动播报
- **统一 ID 管理** — ID 前缀 P/B/V/T，`/alert_list`、`/alert_remove`、`/alert_toggle`、`/alert_history`

### 🔊 ESP32 语音播报
- 所有 6 类告警（price / pump_dump / breakthrough / potential / funding / ranking）可推送到局域网 ESP32 设备做 TTS 播报
- 每类独立开关、全局冷却、静音时段、去 Markdown 清洗
- 命令：`/esp32_status`, `/esp32_on [types]`, `/esp32_off`, `/esp32_test`, `/esp32_cooldown`, `/esp32_quiet`
- 详细设计见 [docs/ESP32_PUSH_FEATURE.md](docs/ESP32_PUSH_FEATURE.md)

### 🛡️ 三级过滤 + 低成交量统一
- **黑名单** (`/black*`) — 完全屏蔽
- **黄名单** (`/yellow*`) — 推送时加 🟡 警告标记
- **临时静音** (`/mute*`) — 定时解除
- **低成交量标记** (`/filter_volume <N>`) — 低于阈值的币不触发主动推送，被动查询时加 💧 标记

### 📝 点评与反馈
- **/note `<币> <内容>`** — 记录点评，自动快照价格/涨跌/费率/排名
- **/notes `<币>`** — 查看该币最近点评
- **/debug `<问题描述>`** — 随手记 Bug，下次会话统一处理

### 🎛️ 交互菜单
- **/menu** — Inline keyboard 快捷菜单：价格警报管理、系统状态、过滤器总览、名单浏览

---

## 🚀 快速开始

### 环境要求
- Node.js >= 16
- TypeScript >= 4.5
- SQLite3
- 可选：Docker（推荐生产部署）

### 本地启动
```bash
git clone <your-fork-url> && cd crypto-tgalert
npm install
cp .env.example .env        # 填入 bot token / 用户 ID / 可选的币安 API key / 可选的 ESP32 网关
npm run build && npm start  # 或 npm run dev 热重载
```

### 必要环境变量
```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_USER_ID=...         # 授权用户 ID，非该用户的消息一律拒绝

# 可选
BINANCE_API_KEY=...
BINANCE_SECRET_KEY=...
OUYU_GATEWAY_URL=http://<esp32-gateway-ip>
OUYU_DEVICE_ID=<esp32-mac-address>
NODE_ENV=production
LOG_LEVEL=info
```

### Docker 部署
见 [DEPLOYMENT_DOCKER.md](DEPLOYMENT_DOCKER.md)。生产机通过 `deploy-vX.Y.Z` tag 触发自动拉取 + 构建 + 热替换。

---

## 📱 命令速查

完整列表在 bot 内 `/help`。下面只列类别：

| 类别 | 主要命令 |
|---|---|
| 行情 | `/price`, `/signals`, `/rank_gainers`, `/rank_losers`, `/funding`, `/oi*`, `/high*` |
| 价格/突破告警 | `/alert`, `/alert_bt`, `/alert_<tf>_<dir>_<pct>_<sym>`, `/alert_list`, `/alert_remove`, `/alert_toggle`, `/alert_history` |
| 潜力/费率告警 | `/potential*`, `/funding_alert_*`, `/breakout_*` |
| ESP32 语音 | `/esp32_status`, `/esp32_on`, `/esp32_off`, `/esp32_test`, `/esp32_cooldown`, `/esp32_quiet` |
| 过滤器 | `/black*`, `/yellow*`, `/mute*`, `/filter_settings`, `/filter_volume`, `/filter_auto` |
| 点评/Debug | `/note`, `/notes`, `/note_remove`, `/debug`, `/debug_list`, `/debug_remove` |
| 系统 | `/menu`, `/status`, `/cache_status`, `/cache_update`, `/push_status`, `/help` |

---

## 🏗️ 关键模块

```
src/
├── bot.ts                      # Telegram 入口 + 命令路由（70 个命令）
├── services/
│   ├── priceMonitor.ts         # 价格告警
│   ├── priceAlertService.ts    # 急涨急跌告警（WS 驱动）
│   ├── breakoutAlertService.ts # 突破告警（P2）
│   ├── potentialAlertService.ts# 潜力币信号
│   ├── fundingAlertService.ts  # 费率告警
│   ├── realtimeAlertService.ts # 排行榜实时推送
│   ├── alerts/UnifiedAlertService.ts  # 告警统一入口
│   ├── esp32/                  # ESP32 语音推送
│   ├── highPointCache/         # 高点缓存（P1，SQLite）
│   ├── binance*.ts             # REST + WebSocket
│   └── ...
├── config/
│   ├── volumeConfig.ts         # 全局成交量阈值（单一真源）
│   └── tokenLists.ts           # 代币列表基础配置
├── indicators/                 # /signals 使用的轻量指标计算
└── utils/
```

---

## 🔒 安全
- 授权用户白名单（`TELEGRAM_USER_ID`），未授权消息直接拒绝
- `.env` 必须设 600 权限且不入仓
- API key 加密存储（若配置）
- SQLite 数据和 `.env` 都已在 `.gitignore`

## 📊 日志与监控
- 应用日志：`logs/`
- 数据：`data/crypto-tgalert.db`（SQLite）
- 所有告警自动写入 `*_alerts` 表 + 冷却去重

## 📄 License
MIT — 见 [LICENSE](LICENSE)

---

⚠️ **风险提示**：本工具仅用于行情监控和数据分析，不构成投资建议。加密货币交易存在高风险，请谨慎决策。
