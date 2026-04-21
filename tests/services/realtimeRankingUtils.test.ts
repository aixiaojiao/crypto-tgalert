import { detectL1NewTop } from '../../src/services/realtimeRankingUtils';

/**
 * 测试 L1 榜首易主检测逻辑
 *
 * 判定规则：
 * - currentPosition === 1 且 previousPosition !== 1
 * - 或 new_entry 直接进入 #1
 * - exit 不可能变成 #1
 */
describe('detectL1NewTop', () => {
  it('新币直接登顶（new_entry at #1）判为 L1', () => {
    const changes = [
      {
        symbol: 'ABCUSDT',
        changeType: 'new_entry' as const,
        currentPosition: 1,
        priceChangePercent: 30,
      },
    ];
    const l1 = detectL1NewTop(changes);
    expect(l1).toBeDefined();
    expect(l1!.symbol).toBe('ABCUSDT');
  });

  it('原榜内从 #2 上升到 #1 判为 L1（即使仅 1 位变动）', () => {
    const changes = [
      {
        symbol: 'BTCUSDT',
        changeType: 'position_change' as const,
        currentPosition: 1,
        previousPosition: 2,
        changeValue: 1,
        priceChangePercent: 5,
      },
    ];
    const l1 = detectL1NewTop(changes);
    expect(l1).toBeDefined();
    expect(l1!.symbol).toBe('BTCUSDT');
  });

  it('从 #5 跳到 #1 判为 L1', () => {
    const changes = [
      {
        symbol: 'ETHUSDT',
        changeType: 'position_change' as const,
        currentPosition: 1,
        previousPosition: 5,
        changeValue: 4,
        priceChangePercent: 15,
      },
    ];
    const l1 = detectL1NewTop(changes);
    expect(l1).toBeDefined();
    expect(l1!.symbol).toBe('ETHUSDT');
  });

  it('#1 保持在 #1（previousPosition === 1）不算 L1', () => {
    const changes = [
      {
        symbol: 'BTCUSDT',
        changeType: 'position_change' as const,
        currentPosition: 1,
        previousPosition: 1,
        changeValue: 0,
        priceChangePercent: 10,
      },
    ];
    expect(detectL1NewTop(changes)).toBeUndefined();
  });

  it('榜内变化但未到 #1 不算 L1', () => {
    const changes = [
      {
        symbol: 'XYZUSDT',
        changeType: 'position_change' as const,
        currentPosition: 3,
        previousPosition: 8,
        changeValue: 5,
        priceChangePercent: 12,
      },
      {
        symbol: 'ABCUSDT',
        changeType: 'new_entry' as const,
        currentPosition: 7,
        priceChangePercent: 11,
      },
    ];
    expect(detectL1NewTop(changes)).toBeUndefined();
  });

  it('exit 类型不算 L1（即使原本是 #1）', () => {
    const changes = [
      {
        symbol: 'OLDUSDT',
        changeType: 'exit' as const,
        previousPosition: 1,
        priceChangePercent: -5,
      },
    ];
    expect(detectL1NewTop(changes)).toBeUndefined();
  });

  it('多条变化中只返回第一条 L1 命中', () => {
    const changes = [
      {
        symbol: 'XYZUSDT',
        changeType: 'position_change' as const,
        currentPosition: 4,
        previousPosition: 9,
        changeValue: 5,
        priceChangePercent: 12,
      },
      {
        symbol: 'BTCUSDT',
        changeType: 'position_change' as const,
        currentPosition: 1,
        previousPosition: 3,
        changeValue: 2,
        priceChangePercent: 20,
      },
    ];
    const l1 = detectL1NewTop(changes);
    expect(l1).toBeDefined();
    expect(l1!.symbol).toBe('BTCUSDT');
  });

  it('空数组返回 undefined', () => {
    expect(detectL1NewTop([])).toBeUndefined();
  });
});
