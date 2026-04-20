import { BreakoutAlertService } from '../services/breakoutAlertService';
import type { Kline } from '../types/binance';

/**
 * BreakoutAlertService 的二次确认 (confirmBreakout) 是纯逻辑函数,
 * 不依赖网络, 便于单元测试. 其他流程 (runScan / sendNotification 等)
 * 需要 Binance + Telegram 真实环境, 在服务器上以 getStatus / Telegram
 * 命令手动验证。
 */
describe('BreakoutAlertService.confirmBreakout', () => {
  const svc = new BreakoutAlertService();

  function makeKline(opts: {
    openTime?: number;
    high?: string | number;
    low?: string | number;
    volume?: string | number;
  }): Kline {
    const qv = opts.volume === undefined ? '0' : String(opts.volume);
    return {
      openTime: opts.openTime ?? Date.now(),
      open: '0',
      high: String(opts.high ?? 0),
      low: String(opts.low ?? 0),
      close: '0',
      volume: '0',
      closeTime: 0,
      quoteAssetVolume: qv,
      numberOfTrades: 0,
      takerBuyBaseAssetVolume: '0',
      takerBuyQuoteAssetVolume: '0',
      ignore: '0',
    };
  }

  it('passes when latest vol is 2x avg and low > refHigh', () => {
    const history = Array.from({ length: 20 }, () => makeKline({ volume: 100 }));
    const latest = makeKline({ volume: 200, low: 101 });
    const result = svc.confirmBreakout([...history, latest], 100);
    expect(result.passed).toBe(true);
    expect(result.volumeRatio).toBeCloseTo(2);
    console.log(`[ok] ratio=${result.volumeRatio.toFixed(2)} passed=${result.passed}`);
  });

  it('rejects when volume ratio < 1.5', () => {
    const history = Array.from({ length: 20 }, () => makeKline({ volume: 100 }));
    const latest = makeKline({ volume: 120, low: 101 });
    const result = svc.confirmBreakout([...history, latest], 100);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/volume ratio/);
    expect(result.volumeRatio).toBeCloseTo(1.2);
    console.log(`[reject-vol] ratio=${result.volumeRatio.toFixed(2)} reason=${result.reason}`);
  });

  it('rejects when latest low <= refHigh (not sustained)', () => {
    const history = Array.from({ length: 20 }, () => makeKline({ volume: 100 }));
    const latest = makeKline({ volume: 200, low: 99 });
    const result = svc.confirmBreakout([...history, latest], 100);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/latest low/);
    console.log(`[reject-sustain] reason=${result.reason}`);
  });

  it('rejects on insufficient klines', () => {
    const result = svc.confirmBreakout([], 100);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/insufficient/);
  });

  it('rejects on zero avg volume', () => {
    const history = Array.from({ length: 20 }, () => makeKline({ volume: 0 }));
    const latest = makeKline({ volume: 100, low: 150 });
    const result = svc.confirmBreakout([...history, latest], 100);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/avg vol/);
  });

  it('rejects on zero latest volume', () => {
    const history = Array.from({ length: 20 }, () => makeKline({ volume: 100 }));
    const latest = makeKline({ volume: 0, low: 150 });
    const result = svc.confirmBreakout([...history, latest], 100);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/latest vol/);
  });

  it('passes at exactly 1.5x threshold', () => {
    const history = Array.from({ length: 20 }, () => makeKline({ volume: 100 }));
    const latest = makeKline({ volume: 150, low: 101 });
    const result = svc.confirmBreakout([...history, latest], 100);
    expect(result.passed).toBe(true);
  });
});
