import { PriceAlertService, PriceSnapshot } from '../services/priceAlertService';

/**
 * 测试最大回撤算法 —— 这是 /brief 和 /yellow_list 🔎 section
 * 触发准确性的核心。覆盖 4 种典型形态：
 *   1) 纯下跌：正常触发
 *   2) 插针回抽：窗口内 peak→trough 仍被抓到（用户最初的顾虑）
 *   3) 纯拉涨：应为 0，不触发
 *   4) 拉涨后崩盘：peak 是新高，trough 是随后的跌点 —— 应触发
 */
describe('PriceAlertService.computeMaxDrawdown', () => {
  const mkSnap = (price: number, tOffset: number): PriceSnapshot => ({
    symbol: 'X',
    price,
    timestamp: 1_700_000_000_000 + tOffset,
    volume24h: 100_000_000,
  });

  it('纯下跌: 100 → 90 → 85 → drawdown 15% from 100 to 85', () => {
    const snaps = [mkSnap(100, 0), mkSnap(90, 1), mkSnap(85, 2)];
    const r = PriceAlertService.computeMaxDrawdown(snaps);
    expect(r.drawdownPercent).toBeCloseTo(15, 5);
    expect(r.peakPrice).toBe(100);
    expect(r.troughPrice).toBe(85);
    expect(r.peakAt).toBe(snaps[0].timestamp);
    expect(r.troughAt).toBe(snaps[2].timestamp);
    console.log(`[纯下跌] dd=${r.drawdownPercent.toFixed(2)}% peak=${r.peakPrice}→${r.troughPrice}`);
  });

  it('插针回抽: 100 → 100 → 88 (wick) → 99 → drawdown 12% captured even though recovered', () => {
    // 关键用例：这是用户放弃 1m 跌幅方案的根本原因 —— 插针回抽到结尾价格接近起点，
    // 但窗口内 peak→trough 的回撤仍必须被抓到
    const snaps = [
      mkSnap(100, 0),
      mkSnap(100, 1),
      mkSnap(88, 2),    // wick
      mkSnap(99, 3),    // recovered
    ];
    const r = PriceAlertService.computeMaxDrawdown(snaps);
    expect(r.drawdownPercent).toBeCloseTo(12, 5);
    expect(r.peakPrice).toBe(100);
    expect(r.troughPrice).toBe(88);
    console.log(`[插针回抽] dd=${r.drawdownPercent.toFixed(2)}% peak=${r.peakPrice}→${r.troughPrice}`);
  });

  it('纯拉涨: 100 → 105 → 112 → drawdown = 0, 不触发', () => {
    // 用户明确：方案 B 的语义是只抓下行，单边拉涨不应被打 🔎
    const snaps = [mkSnap(100, 0), mkSnap(105, 1), mkSnap(112, 2)];
    const r = PriceAlertService.computeMaxDrawdown(snaps);
    expect(r.drawdownPercent).toBe(0);
    console.log(`[纯拉涨] dd=${r.drawdownPercent}%（预期 0）`);
  });

  it('拉涨后崩盘: 100 → 120 → 100 → peak 是新高 120，trough 是 100，回撤 ~16.67%', () => {
    const snaps = [mkSnap(100, 0), mkSnap(120, 1), mkSnap(100, 2)];
    const r = PriceAlertService.computeMaxDrawdown(snaps);
    expect(r.drawdownPercent).toBeCloseTo((120 - 100) / 120 * 100, 5);
    expect(r.peakPrice).toBe(120);
    expect(r.troughPrice).toBe(100);
    expect(r.peakAt).toBe(snaps[1].timestamp);
    expect(r.troughAt).toBe(snaps[2].timestamp);
    console.log(`[拉涨后崩] dd=${r.drawdownPercent.toFixed(2)}% peak=${r.peakPrice}→${r.troughPrice}`);
  });

  it('阈值临界: 刚好 10% 跌幅应被函数返回（由上层阈值决定是否落库）', () => {
    const snaps = [mkSnap(100, 0), mkSnap(90, 1)];
    const r = PriceAlertService.computeMaxDrawdown(snaps);
    expect(r.drawdownPercent).toBeCloseTo(10, 5);
  });

  it('单快照: 退化场景返回 0', () => {
    const r = PriceAlertService.computeMaxDrawdown([mkSnap(100, 0)]);
    expect(r.drawdownPercent).toBe(0);
  });

  it('双峰场景: 100 → 90 (dd 10%) → 95 → 70 (dd 25% from 95) → 取最大 25%', () => {
    // 回撤中出现反弹又创新低，应以更深的那次为准
    const snaps = [
      mkSnap(100, 0),
      mkSnap(90, 1),
      mkSnap(95, 2),
      mkSnap(70, 3),
    ];
    const r = PriceAlertService.computeMaxDrawdown(snaps);
    // 第二段回撤：peak 仍是 100（100 > 95 没被刷新），trough=70，dd = 30%
    expect(r.drawdownPercent).toBeCloseTo(30, 5);
    expect(r.peakPrice).toBe(100);
    expect(r.troughPrice).toBe(70);
    console.log(`[双峰] dd=${r.drawdownPercent.toFixed(2)}% peak=${r.peakPrice}→${r.troughPrice}`);
  });
});
