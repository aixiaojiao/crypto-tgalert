/**
 * 实时涨幅榜推送相关的纯函数工具
 *
 * 独立模块以避免测试时拉入 realtimeMarketCache 的网络副作用。
 */

export interface RankingChange {
  symbol: string;
  currentPosition?: number;
  previousPosition?: number;
  changeType: 'new_entry' | 'position_change' | 'exit';
  changeValue?: number;
  priceChangePercent: number;
}

/**
 * 检测"榜首易主"事件（L1）：有币进入 #1 且之前不在 #1
 * 包含新入榜直达 #1 与原榜内上升至 #1 两种情形
 */
export function detectL1NewTop(changes: RankingChange[]): RankingChange | undefined {
  return changes.find(c =>
    c.currentPosition === 1 &&
    (c.changeType === 'new_entry' ||
      (c.changeType === 'position_change' && c.previousPosition !== 1))
  );
}
