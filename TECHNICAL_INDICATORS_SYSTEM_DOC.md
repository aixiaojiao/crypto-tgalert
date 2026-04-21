# /signals 技术分析命令

> 对应 bot 命令：`/signals <symbol> [timeframe] [strategy]`

## 功能

对单个币种做一次**基础技术信号评估**，用于快速感知当前动能强度。不是决策工具，只是一个辅助判断。

## 用法

```
/signals btc                  # BTC 1h / balanced（默认）
/signals eth 1h               # ETH 1 小时
/signals doge balanced        # DOGE 平衡策略
```

参数：
- `symbol`：必填，不带 USDT（bot 会自动补）。已下架 / 黑名单币种直接拒绝
- `timeframe`：可选，默认 `1h`
- `strategy`：可选，默认 `balanced`

## 当前的评估维度

命令会拉取期货价格 + 24h stats + 资金费率，基于以下三点打分：

| 维度 | 信号 | 打分 |
|---|---|---|
| 价格动量 (24h%) | \|%\| > 5% | ±20 |
| | \|%\| > 2% | ±10 |
| | 其他 | 0 |
| 成交量 (百万 USDT) | > 100M | +10 |
| | > 50M | +5 |
| 资金费率 | 由费率方向微调 | ± |

总分 + 信号列表一并返回。

## 实现位置

- 命令处理：`src/bot.ts` 的 `/signals` handler（约 L1740）
- 指标基础模块：`src/indicators/`（预留的 RSI/MACD/布林/KDJ 骨架，目前 `/signals` 走的是上述动量+量能的轻量实现，复杂指标未接入）

## 未实现 / 已裁剪

下列内容在历史文档里描述过，但**目前没有落地**，使用时不要期待：

- RSI / MACD / 布林带 / KDJ / 威廉指标 的真实信号输出
- 多策略切换（`strategy` 参数目前只作占位，不影响结果）
- 多指标综合加权评分
- 实时 WebSocket K 线驱动

如果后面决定补齐，从 `src/indicators/services/TechnicalIndicatorEngine.ts` 扩展接入即可。

## 风险提示

`/signals` 给出的分数只反映当前时刻的价量情况，不考虑趋势背景、多时间框架共振、新闻面等。不要单独作为交易依据。
