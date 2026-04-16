# ESP32 语音告警推送

> 状态：**已实施（v1）**
> 实现时间：2026-04-16
> 目标：crypto-tgalert 触发告警时，除 Telegram 外，经 ouyu-v2 设备网关推送 TTS 语音告警到绑定"招福"角色的 ESP32 设备。

---

## 1. 最终决策（5 问回复）

| # | 问题 | 决策 |
|---|------|------|
| Q1 | 服务器位置 | 杭州 ECS `47.111.161.136`（原"上海"是口误） |
| Q2 | TTS 文案质量 | 机械朗读，不走 AI 润色 |
| Q3 | 告警类型控制 | `/esp32_on <type>` 参数制，5 种类型 |
| Q4 | 设备离线处理 | 吞掉错误，Telegram 照常 |
| Q5 | 多设备 | 绑定"招福"的 ESP32，`device_id = 94:a9:90:29:00:44` |

## 2. 架构

```
告警触发点                       Esp32NotificationService         ouyu-v2 device-gateway
──────────────                   ─────────────────────────         ──────────────────────
potentialAlertService    ──┐
realtimeAlertService     ──┤
priceAlertService        ──┼──► pushAlert(type, text)  ────►  POST /v1/devices/{id}/push
priceMonitor             ──┤    ├ 过滤：enabled 总开关                 │
UnifiedAlertService      ──┘    ├ 过滤：type 订阅                     ▼
                                ├ 过滤：静音时段                  TTS → opus → WS
                                ├ 过滤：全局冷却 60s                  │
                                └ 失败吞掉                            ▼
                                                                   ESP32 播报
```

**设计原则**：
- **失败隔离**：ESP32 推送失败（网络/设备离线/超时）绝不影响 Telegram 主通道
- **最小入侵**：在现有 5 个告警发送点并行新增 `pushAlert` 调用，不改动现有流程
- **全局冷却**：默认 60 秒。仅为避免两条语音首尾相接互相打断；业务冷却交给 Telegram 层

## 3. 告警类型（`/esp32_on` 参数）

| type | 来源 | 触发方式 | Hook 文件 |
|------|------|----------|-----------|
| `potential` | 潜力信号扫描 | 自动 10 分钟扫描 | `src/services/potentialAlertService.ts` |
| `breakthrough` | 历史新高突破 | 自动，基于用户 `/alert_bt` 配置 | `src/services/alerts/UnifiedAlertService.ts` |
| `ranking` | 涨幅榜实时变化 | 自动，WebSocket 事件驱动 | `src/services/realtimeAlertService.ts` |
| `price` | 用户 `/alert` 价格线 | 自动 | `src/services/priceMonitor.ts` |
| `pump_dump` | 时段涨跌幅（`/alert_5m_gain_3_all`） | 自动 | `src/services/priceAlertService.ts` |

> 注：`/rank_gainers` / `/funding` 等**查询命令**不触发告警，不纳入 ESP32 推送范围。

## 4. Telegram 控制命令

```
/esp32_status                    查看：总开关、订阅类型、设备、冷却、静音
/esp32_on                        仅开启总开关（不改订阅）
/esp32_on potential ranking      启用并订阅指定类型
/esp32_on all                    订阅全部 5 种
/esp32_off                       仅关闭总开关（订阅保留）
/esp32_off breakthrough          取消订阅指定类型
/esp32_off all                   清空所有订阅
/esp32_test [text]               立刻发一条测试消息（忽略过滤）
/esp32_cooldown 60               设置全局冷却秒数（0~3600）
/esp32_quiet 23:00-08:00         设置静音时段（支持跨午夜）
/esp32_quiet off                 清除静音
```

## 5. 环境变量

```env
# ESP32 语音推送（crypto-tgalert → 杭州 nginx → ouyu-v2 device-gateway）
OUYU_GATEWAY_URL=http://47.111.161.136
OUYU_DEVICE_ID=94:a9:90:29:00:44
```

未设置任一变量：Esp32 功能整体禁用（`/esp32_status` 会提示）。

## 6. 网络拓扑

- **crypto-tgalert** 部署于 **Singapore ECS `43.134.118.159`** （Docker）
- **ouyu-v2 device-gateway** 部署于 **杭州 ECS `47.111.161.136`**
  - 实际监听：`127.0.0.1:18003`（只绑 loopback，安全默认）
  - 公网入口：nginx 80 端口反代
- **nginx location**（加在 `/etc/nginx/sites-enabled/ouyu-v2-staging.conf`）：
  ```nginx
  location /v1/devices/ {
      allow 43.134.118.159;   # 仅放行新加坡
      deny all;
      proxy_pass http://127.0.0.1:18003;
      proxy_set_header Host $host;
      proxy_connect_timeout 10s;
      proxy_read_timeout 30s;
  }
  ```
- **安全组**：杭州 ECS 80 端口本就已开（nginx 对外入口），无需额外改动。IP 白名单由 nginx `allow/deny` 层做。
- **HTTP 客户端超时**：15 秒（TTS 合成 + 传输实测 ~5 秒）

## 7. 文件清单

**新增**：
- `src/services/esp32/OuyuPushClient.ts` — HTTP 客户端（永不抛）
- `src/services/esp32/Esp32NotificationService.ts` — 过滤器 + 持久化 + 清洗
- `src/services/esp32/index.ts` — 模块单例
- `tests/services/esp32/OuyuPushClient.test.ts`
- `tests/services/esp32/Esp32NotificationService.test.ts`

**修改**：
- `src/database/schema.ts` — 新增 `esp32_config` 表（按 user_id 单行）
- `src/bot.ts` — 注册 6 个 `/esp32_*` 命令 + 菜单
- `src/services/potentialAlertService.ts` — 后挂 `pushAlert('potential', msg)`
- `src/services/realtimeAlertService.ts` — 后挂 `pushAlert('ranking', summary)`
- `src/services/priceAlertService.ts` — 后挂 `pushAlert('pump_dump', summary)`
- `src/services/priceMonitor.ts` — 后挂 `pushAlert('price', summary)`
- `src/services/alerts/UnifiedAlertService.ts` — BREAKTHROUGH/MULTI_BREAKTHROUGH 后挂
- `.env.example` — 新增 `OUYU_*` 变量

## 8. 测试覆盖

`tests/services/esp32/` 32 个用例全通过：
- `OuyuPushClient.test.ts` — URL 构造、JSON body、404 离线、网络错误、超时中止、空文本/空设备拒绝
- `Esp32NotificationService.test.ts` — 默认行、启停类型、all 扩展、冷却阻断、失败不消耗冷却、异常吞掉、cleanForTts、跨午夜静音

## 9. 部署步骤（已完成）

1. ✅ 杭州 ECS nginx 配置 `/v1/devices/` 反代块 + IP 白名单 `43.134.118.159`
2. ✅ Singapore `/home/ubuntu/crypto-tgalert/.env` 追加 `OUYU_GATEWAY_URL` + `OUYU_DEVICE_ID`
3. ✅ rsync src/ + `docker compose up --build -d` 重建容器
4. ✅ 端到端验证：Singapore curl POST `http://47.111.161.136/v1/devices/94:a9:90:29:00:44/push` 返回 `{"status":"ok"}`，设备实际播报
5. ⏳ Telegram 用户端：`/esp32_test` 确认 + `/esp32_on <types>` 启用订阅

## 10. 已知限制与后续

- 排行榜告警使用短摘要（新入榜前 3 个 + 排名变化前 2 个），避免播报整份 TOP10
- 全局冷却为进程内变量，多实例部署会各自计时（当前单实例，不是问题）
- 没做 AI 润色（Q2 用户要求机械朗读）；如后续想加，接入 `brain-service` `/v1/characters/assemble` 的 TTS 润色能力即可
- 设备离线重试策略为 A（吞掉）；若后续发现丢告警过多，可改为短窗口（60s）重试 1 次

---

> 调研阶段的原始讨论已被本终版替换；旧版问题清单可查 git 历史（本文件上一个提交）。
