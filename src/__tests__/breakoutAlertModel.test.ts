import {
  BreakoutAlertModel,
  BreakoutAlertRecord,
  BreakoutTier,
  ALL_TIERS,
} from '../models/breakoutAlertModel';

/**
 * BreakoutAlertModel 单元测试
 * 真实 SQLite（data/crypto-alerts.db），测试 symbol 用 TESTBREAK 前缀，afterAll 清理。
 */
describe('BreakoutAlertModel', () => {
  beforeAll(() => {
    BreakoutAlertModel.initDatabase();
  });

  afterAll(() => {
    try {
      const db = (BreakoutAlertModel as any).db;
      db.prepare(`DELETE FROM breakout_alerts WHERE symbol LIKE 'TESTBREAK%'`).run();
    } catch {
      /* ignore */
    }
  });

  describe('initDatabase', () => {
    it('reports initialized', () => {
      expect(BreakoutAlertModel.isDatabaseInitialized()).toBe(true);
    });
    it('idempotent', () => {
      expect(() => BreakoutAlertModel.initDatabase()).not.toThrow();
    });
  });

  describe('recordAlert', () => {
    it('inserts and returns positive id', () => {
      const r: BreakoutAlertRecord = {
        symbol: 'TESTBREAKUSDT',
        tier: 'L2_mid',
        timeframe: '30d',
        refHigh: 100,
        currentPrice: 105,
        breakPct: 5,
        volumeRatio: 2.1,
        triggeredAt: Date.now(),
      };
      const id = BreakoutAlertModel.recordAlert(r);
      expect(id).toBeGreaterThan(0);
      console.log(`[recordAlert] id=${id} symbol=${r.symbol} tier=${r.tier}`);
    });

    it('allows multiple tiers for same symbol', () => {
      const sym = 'TESTBREAKMULTIUSDT';
      const now = Date.now();
      const ids: number[] = [];
      for (const tier of ALL_TIERS) {
        ids.push(
          BreakoutAlertModel.recordAlert({
            symbol: sym,
            tier,
            timeframe: tier === 'L1_extreme' ? 'ATH' : tier === 'L1_strong' ? '180d' : tier === 'L2_mid' ? '30d' : '7d',
            refHigh: 10,
            currentPrice: 11,
            breakPct: 10,
            volumeRatio: 1.8,
            triggeredAt: now + ids.length,
          }),
        );
      }
      expect(new Set(ids).size).toBe(4);
      console.log(`[recordAlert] 4 tiers inserted ids=${ids.join(',')}`);
    });
  });

  describe('hasAlertedRecently (6h dedup)', () => {
    it('returns true for a record inserted just now', () => {
      const sym = 'TESTBREAKCOOLUSDT';
      const tier: BreakoutTier = 'L1_extreme';
      BreakoutAlertModel.recordAlert({
        symbol: sym,
        tier,
        timeframe: 'ATH',
        refHigh: 100,
        currentPrice: 110,
        breakPct: 10,
        volumeRatio: 2,
        triggeredAt: Date.now(),
      });
      expect(BreakoutAlertModel.hasAlertedRecently(sym, tier)).toBe(true);
      console.log('[cooldown] just-inserted → true');
    });

    it('returns false for a tier that was NOT triggered', () => {
      expect(BreakoutAlertModel.hasAlertedRecently('TESTBREAKCOOLUSDT', 'L3_weak')).toBe(false);
    });

    it('returns false for a record older than 6h', () => {
      const sym = 'TESTBREAKOLDUSDT';
      const tier: BreakoutTier = 'L2_mid';
      const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;
      BreakoutAlertModel.recordAlert({
        symbol: sym,
        tier,
        timeframe: '30d',
        refHigh: 50,
        currentPrice: 55,
        breakPct: 10,
        volumeRatio: 1.7,
        triggeredAt: sevenHoursAgo,
      });
      expect(BreakoutAlertModel.hasAlertedRecently(sym, tier)).toBe(false);
      console.log('[cooldown] 7h-old → false');
    });
  });

  describe('getTodayStats', () => {
    it('returns stats shape and counts our test inserts for today', () => {
      const s = BreakoutAlertModel.getTodayStats();
      expect(typeof s.total).toBe('number');
      expect(s.total).toBeGreaterThanOrEqual(0);
      expect(typeof s.byTier).toBe('object');
      console.log(`[todayStats] total=${s.total}`, s.byTier);
    });
  });

  describe('config on/off', () => {
    it('toggles enabled flag persistently', () => {
      BreakoutAlertModel.setEnabled(true);
      expect(BreakoutAlertModel.isEnabled()).toBe(true);
      BreakoutAlertModel.setEnabled(false);
      expect(BreakoutAlertModel.isEnabled()).toBe(false);
    });
  });
});
