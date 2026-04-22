import { AutoObservedLogModel, AutoObservedLogRecord } from '../models/autoObservedLogModel';

/**
 * AutoObservedLogModel 单元测试
 * 真实 SQLite（data/crypto-alerts.db），测试 symbol 用 TESTAUTOOBS 前缀，afterAll 清理。
 */
describe('AutoObservedLogModel', () => {
  beforeAll(() => {
    AutoObservedLogModel.initDatabase();
  });

  afterAll(() => {
    try {
      const db = (AutoObservedLogModel as any).db;
      db.prepare(`DELETE FROM auto_observed_log WHERE symbol LIKE 'TESTAUTOOBS%'`).run();
    } catch {
      /* ignore */
    }
  });

  describe('initDatabase', () => {
    it('reports initialized', () => {
      expect(AutoObservedLogModel.isDatabaseInitialized()).toBe(true);
    });
    it('idempotent', () => {
      expect(() => AutoObservedLogModel.initDatabase()).not.toThrow();
    });
  });

  const makeRecord = (overrides: Partial<AutoObservedLogRecord> = {}): AutoObservedLogRecord => ({
    symbol: 'TESTAUTOOBSUSDT',
    triggeredAt: Date.now(),
    drawdownPercent: 12.5,
    peakPrice: 100,
    troughPrice: 87.5,
    peakAt: Date.now() - 60_000,
    troughAt: Date.now(),
    volume24h: 50_000_000,
    ...overrides,
  });

  describe('recordObservation', () => {
    it('inserts and returns positive id', () => {
      const id = AutoObservedLogModel.recordObservation(makeRecord());
      expect(id).toBeGreaterThan(0);
      console.log(`[recordObservation] id=${id}`);
    });

    it('allows multiple records for same symbol (append-only)', () => {
      const sym = 'TESTAUTOOBSMULTIUSDT';
      const now = Date.now();
      const ids = [1, 2, 3].map(i =>
        AutoObservedLogModel.recordObservation(makeRecord({
          symbol: sym,
          triggeredAt: now + i,
          drawdownPercent: 10 + i,
        }))
      );
      expect(new Set(ids).size).toBe(3);
      console.log(`[recordObservation] 3 appends, ids=${ids.join(',')}`);
    });
  });

  describe('wasObservedRecently (5m cooldown)', () => {
    it('returns true for a just-inserted record', () => {
      const sym = 'TESTAUTOOBSCOOLUSDT';
      AutoObservedLogModel.recordObservation(makeRecord({
        symbol: sym,
        triggeredAt: Date.now(),
      }));
      expect(AutoObservedLogModel.wasObservedRecently(sym)).toBe(true);
    });

    it('returns false for symbol never observed', () => {
      expect(AutoObservedLogModel.wasObservedRecently('TESTAUTOOBSNEVERUSDT')).toBe(false);
    });

    it('returns false for a record older than 5 minutes', () => {
      const sym = 'TESTAUTOOBSOLDUSDT';
      const sixMinAgo = Date.now() - 6 * 60 * 1000;
      AutoObservedLogModel.recordObservation(makeRecord({
        symbol: sym,
        triggeredAt: sixMinAgo,
      }));
      expect(AutoObservedLogModel.wasObservedRecently(sym)).toBe(false);
    });
  });

  describe('listSince & summarizeSince', () => {
    it('listSince returns records in ascending triggered_at order', () => {
      const base = 'TESTAUTOOBSLISTUSDT';
      const now = Date.now();
      AutoObservedLogModel.recordObservation(makeRecord({ symbol: base, triggeredAt: now + 100, drawdownPercent: 11 }));
      AutoObservedLogModel.recordObservation(makeRecord({ symbol: base, triggeredAt: now + 50,  drawdownPercent: 12 }));
      AutoObservedLogModel.recordObservation(makeRecord({ symbol: base, triggeredAt: now + 200, drawdownPercent: 13 }));

      const rows = AutoObservedLogModel.listSince(now)
        .filter(r => r.symbol === base);
      expect(rows.length).toBe(3);
      expect(rows[0].triggeredAt).toBeLessThan(rows[1].triggeredAt);
      expect(rows[1].triggeredAt).toBeLessThan(rows[2].triggeredAt);
    });

    it('summarizeSince aggregates per symbol: count + maxDrawdown + latestDrawdown', () => {
      const sym = 'TESTAUTOOBSSUMUSDT';
      const now = Date.now();
      AutoObservedLogModel.recordObservation(makeRecord({ symbol: sym, triggeredAt: now + 1000, drawdownPercent: 15 }));
      AutoObservedLogModel.recordObservation(makeRecord({ symbol: sym, triggeredAt: now + 2000, drawdownPercent: 12 }));
      AutoObservedLogModel.recordObservation(makeRecord({ symbol: sym, triggeredAt: now + 3000, drawdownPercent: 20 })); // latest

      const all = AutoObservedLogModel.summarizeSince(now + 500);
      const mine = all.find(s => s.symbol === sym);
      expect(mine).toBeDefined();
      expect(mine!.count).toBe(3);
      expect(mine!.maxDrawdown).toBe(20);
      expect(mine!.latestDrawdown).toBe(20);
      console.log(`[summarize] ${sym} count=${mine!.count} max=${mine!.maxDrawdown} latest=${mine!.latestDrawdown}`);
    });

    it('summarizeSince orders by count desc', () => {
      const prefix = 'TESTAUTOOBSORDERUSDT';
      const now = Date.now();
      // sym A: 1 trigger
      AutoObservedLogModel.recordObservation(makeRecord({ symbol: prefix + 'A', triggeredAt: now + 10 }));
      // sym B: 3 triggers
      for (let i = 0; i < 3; i++) {
        AutoObservedLogModel.recordObservation(makeRecord({ symbol: prefix + 'B', triggeredAt: now + 20 + i }));
      }

      const all = AutoObservedLogModel.summarizeSince(now)
        .filter(s => s.symbol.startsWith(prefix));
      expect(all[0].symbol).toBe(prefix + 'B');
      expect(all[0].count).toBe(3);
      expect(all[1].symbol).toBe(prefix + 'A');
      expect(all[1].count).toBe(1);
    });
  });

  describe('clearAll', () => {
    it('removes all records and returns count', () => {
      const sym = 'TESTAUTOOBSCLEARUSDT';
      AutoObservedLogModel.recordObservation(makeRecord({ symbol: sym }));
      const before = AutoObservedLogModel.listSince(0).length;
      expect(before).toBeGreaterThan(0);

      const removed = AutoObservedLogModel.clearAll();
      expect(removed).toBe(before);

      expect(AutoObservedLogModel.listSince(0).length).toBe(0);
    });
  });
});
