# ESP32 语音告警推送 — 调研文档

> 状态：**调研阶段，待讨论**
> 目标：crypto-tgalert 触发告警时，除 Telegram 外，额外经由 ouyu-v2 设备网关推送 TTS 语音告警到 ESP32 设备。
> 创建时间：2026-04-16

---

## 1. 背景

当前告警渠道只有 Telegram。问题：
- 手机不在手边可能错过关键告警（突破历史新高、爆仓事件等）
- Telegram 通知容易被其他消息淹没
- 想要一个"被动接收"的物理通道，让设备主动提醒

思路：复用 ouyu-v2 项目已有的 ESP32 设备基础设施，把 crypto 告警文本推送到设备网关，走 TTS 转成语音，由 ESP32 播报。

---

## 2. ouyu-v2 侧现状（调研结果）

### 2.1 项目位置与架构

- **项目路径**：`/home/chala/ouyu-v2`
- **性质**：AI 角色陪伴设备项目（微信小程序 + ESP32 硬件）
- **核心服务**：
  - `apps/device-gateway/` — Python aiohttp，ESP32 的 WebSocket/HTTP 网关
  - `apps/brain-service/` — Python，角色身份和 TTS 内容生成（port 8091）
  - `apps/api-service/` — Java/Spring Boot，小程序 API（port 19090）

### 2.2 部署位置

**当前部署**：杭州阿里云 ECS
- IP：`47.111.161.136`
- 端口：
  - `18000` — device-gateway WebSocket（ESP32 连接）
  - `18003` — device-gateway HTTP（推送 API 在这里）
  - `8091` — brain-service
  - `19090` — api-service

⚠️ **没有扫到上海服务器配置**。
`.env` 系列文件中只有杭州 staging 环境。如果要部署到上海，需要：
- 新配置 `.env.shanghai`
- 设置 `DEVICE_GATEWAY_HTTP_URL=http://<shanghai-ip>:18003`
- 可能需要 nginx 反代

### 2.3 推送接口（HTTP，无认证）

**单设备推送**：
```
POST http://<gateway>:18003/v1/devices/{device_id}/push
Content-Type: application/json

{"text": "BTC突破75000美元，24小时涨幅5.2%"}
```

**广播给所有在线设备**：
```
POST http://<gateway>:18003/v1/devices/push/broadcast
Content-Type: application/json

{"text": "..."}
```

**查询在线设备**：
```
GET http://<gateway>:18003/v1/devices/online
```

**行为说明**：
- 文本自动交给 TTS 引擎（通义千问 qwen TTS，阿里云 DashScope）
- 返回 `{"status": "ok"}` 即完成；设备离线返回 404
- 消息以 opus 音频帧通过 WebSocket 推到 ESP32
- 设备解码即时播放，无需固件改动

### 2.4 相关文件引用

- 推送接口处理：`apps/device-gateway/core/api/push_handler.py:30-190`
- HTTP 路由注册：`apps/device-gateway/core/http_server.py:191-197`
- 已有调用方（参考实现）：`apps/brain-service/src/ouyu_v2/brain_service/scheduler.py:181-213`（brain-service 的定时提醒功能就用这个接口）

---

## 3. ESP32 侧现状

- 固件项目：`/home/chala/xiaozhi-esp32`
- 已支持接收 TTS 消息并播放（无需改固件即可工作）
- WebSocket 心跳保活（服务端每 60s ping，固件 120s 超时）
- 设备身份：通过 WebSocket 连接时的 `device-id` header 标识

---

## 4. 可行性评估

### ✅ 技术上完全可行

- ouyu-v2 提供了现成的 HTTP 推送接口，无认证（开放）
- 消息格式极简（单字段 `text`）
- ESP32 固件已完整支持 TTS 播放，零改动
- crypto-tgalert 侧新增代码量估计 100~150 行

### 需要澄清的产品问题

#### Q1：服务器位置
调研没找到上海服务器。请确认：
- 是新开一台上海 ECS？
- 还是把杭州的当"上海"用？
- 还是 ouyu-v2 有另一套部署没被我扫到？

#### Q2：TTS 文案质量
直接把 `"BTC突破75000，24h涨幅5.2%"` 送去 TTS，会是机械朗读。
- 是否需要让 brain-service 用 AI 角色口吻润色？类似："主人，比特币刚刚突破了 7.5 万美金哦～"
- 润色会增加延迟（LLM 调用 1~3s）和成本，但体验显著更好
- 润色是可选的，先上第一版不做润色，后续再加

#### Q3：告警风暴控制
crypto 告警触发频繁，尤其行情剧烈时。如果全部推到语音：
- 设备一直播语音 → 非常吵
- 必须在 crypto-tgalert 端做筛选

**建议筛选规则**（讨论方向）：
- 只推送**高优先级**告警（历史新高突破、关键价位突破、爆仓预警等）
- 同币种 **N 分钟去重**（比如 10 分钟内 BTC 只播一次）
- **静音时段**（比如 23:00-08:00 不推送）
- 用户可通过 `/esp32_on`、`/esp32_off`、`/esp32_quiet 23:00-08:00` 等命令控制

#### Q4：设备离线处理
推送失败（设备离线返回 404）时：
- 吃掉错误，Telegram 照常推送？（推荐）
- 还是重试/排队？

#### Q5：多设备
如果你有多个 ESP32 设备：
- 指定 `device_id` 推送到特定设备？
- 用 broadcast 推送到所有设备？
- 配置为环境变量

---

## 5. 初步实施方案（待讨论后细化）

### 5.1 新增代码结构

```
crypto-tgalert/
├── src/
│   └── services/
│       ├── ouyuPushService.ts     # 新增：HTTP 推送服务
│       └── alerts/
│           └── channels/
│               └── esp32Channel.ts # 新增：作为通知渠道接入
└── docs/
    └── ESP32_PUSH_FEATURE.md       # 本文档
```

### 5.2 新增环境变量

```env
# ESP32 语音告警（可选，留空则禁用）
OUYU_GATEWAY_URL=http://<ip>:18003
OUYU_DEVICE_ID=<your-device-id>         # 留空则广播
OUYU_ENABLED=false                       # 总开关
OUYU_QUIET_HOURS=                        # 格式 "23:00-08:00"，留空不静音
OUYU_COOLDOWN_MINUTES=10                 # 同币种冷却（分钟）
OUYU_HIGH_PRIORITY_ONLY=true             # 只推送高优先级告警
```

### 5.3 集成点

在 `NotificationService`（或 realtime alert 触发链路里）加一个 channel：
- Telegram 发送不变（独立执行）
- ESP32 推送作为并行渠道，失败不影响 Telegram
- 共享现有的 cooldown 和 filter 逻辑

### 5.4 Telegram 控制命令

```
/esp32_status               # 查看 ESP32 推送状态
/esp32_on                   # 启用
/esp32_off                  # 禁用
/esp32_test                 # 测试推送
/esp32_quiet 23:00-08:00    # 设置静音时段
/esp32_cooldown 10          # 设置冷却分钟
```

---

## 6. 待办（讨论后）

- [ ] 确认上海服务器具体情况
- [ ] 确认告警筛选规则（优先级、冷却、静音时段）
- [ ] 确认 TTS 文案是否走 brain-service 润色（第一版建议不润色）
- [ ] 确认多设备策略（指定设备 vs 广播）
- [ ] 实施（估计 0.5~1 天）
