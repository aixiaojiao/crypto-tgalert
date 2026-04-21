import {
  HistoricalHighModel,
  HistoricalHighRecord,
  ALL_TIMEFRAMES,
} from '../models/historicalHighModel';

/**
 * HistoricalHighModel 单元测试
 *
 * 使用真实数据库（data/crypto-alerts.db）。测试 symbol 统一用 `TESTHIGHSYM...`
 * 前缀，afterAll 清理，不污染生产数据。
 */
describe('HistoricalHighModel', () => {
  beforeAll(() => {
    HistoricalHighModel.initDatabase();
  });

  afterAll(() => {
    try {
      const db = (HistoricalHighModel as any).db;
      db.prepare(`DELETE FROM historical_highs WHERE symbol LIKE 'TESTHIGHSYM%'`).run();
    } catch {
      /* ignore */
    }
  });

  describe('initDatabase', () => {
    it('should be initialized', () => {
      expect(HistoricalHighModel.isDatabaseInitialized()).toBe(true);
    });
    it('should be idempotent', () => {
      expect(() => HistoricalHighModel.initDatabase()).not.toThrow();
    });
  });

  describe('upsertHigh + getHigh', () => {
    it('upsert a new row, then read it back exactly', () => {
      const now = Date.now();
      const rec: HistoricalHighRecord = {
        symbol: 'TESTHIGHSYM1USDT',
        timeframe: '7d',
        highPrice: 123.456,
        highAt: now - 3600_000,
        windowStart: now - 7 * 86_400_000,
        windowEnd: now,
        collectedAt: now,
      };
      HistoricalHighModel.upsertHigh(rec);
      const out = HistoricalHighModel.getHigh(rec.symbol, '7d');
      expect(out).not.toBeNull();
      expect(out!.highPrice).toBe(123.456);
      expect(out!.highAt).toBe(rec.highAt);
      expect(out!.windowStart).toBe(rec.windowStart);
      expect(out!.timeframe).toBe('7d');
      console.log(`[upsertHigh] read back ${out!.symbol}/${out!.timeframe} high=${out!.highPrice}`);
    });

    it('upsert again updates existing row (PK: symbol+timeframe)', () => {
      const now = Date.now();
      const rec: HistoricalHighRecord = {
        symbol: 'TESTHIGHSYM1USDT',
        timeframe: '7d',
        highPrice: 999.0,
        highAt: now,
        windowStart: now - 7 * 86_400_000,
        windowEnd: now,
        collectedAt: now,
      };
      HistoricalHighModel.upsertHigh(rec);
      const out = HistoricalHighModel.getHigh(rec.symbol, '7d');
      expect(out!.highPrice).toBe(999.0);
      console.log(`[upsertHigh] overwrote to high=${out!.highPrice}`);
    });

    it('getHigh returns null for non-existent entry', () => {
      const out = HistoricalHighModel.getHigh('TESTHIGHSYM404USDT', '7d');
      expect(out).toBeNull();
    });
  });

  describe('getAllHighsForSymbol', () => {
    it('returns record for each of 5 timeframes, null for missing', () => {
      const sym = 'TESTHIGHSYM2USDT';
      const now = Date.now();
      // 写 3 条，缺 180d 和 ATH
      for (const tf of ['7d', '30d', '52w'] as const) {
        HistoricalHighModel.upsertHigh({
          symbol: sym,
          timeframe: tf,
          highPrice: 10.0 + tf.length,
          highAt: now,
          windowStart: now - 86_400_000,
          windowEnd: now,
          collectedAt: now,
        });
      }
      const all = HistoricalHighModel.getAllHighsForSymbol(sym);
      expect(all['7d']).not.toBeNull();
      expect(all['30d']).not.toBeNull();
      expect(all['52w']).not.toBeNull();
      expect(all['180d']).toBeNull();
      expect(all['ATH']).toBeNull();
      console.log(`[getAllHighsForSymbol] covered: 7d=${!!all['7d']} 30d=${!!all['30d']} 180d=${!!all['180d']} 52w=${!!all['52w']} ATH=${!!all['ATH']}`);
    });

    it('ALL_TIMEFRAMES shape matches return keys', () => {
      const all = HistoricalHighModel.getAllHighsForSymbol('TESTHIGHSYM2USDT');
      for (const tf of ALL_TIMEFRAMES) {
        expect(tf in all).toBe(true);
      }
    });
  });

  describe('getAllForTimeframe', () => {
    it('returns only rows of the given timeframe across all symbols', () => {
      const now = Date.now();
      HistoricalHighModel.upsertHigh({
        symbol: 'TESTHIGHSYM3USDT',
        timeframe: 'ATH',
        highPrice: 88.0,
        highAt: now,
        windowStart: now - 3 * 86_400_000,
        windowEnd: now,
        collectedAt: now,
      });
      HistoricalHighModel.upsertHigh({
        symbol: 'TESTHIGHSYM4USDT',
        timeframe: 'ATH',
        highPrice: 99.0,
        highAt: now,
        windowStart: now - 3 * 86_400_000,
        windowEnd: now,
        collectedAt: now,
      });
      HistoricalHighModel.upsertHigh({
        symbol: 'TESTHIGHSYM5USDT',
        timeframe: '30d',
        highPrice: 12.0,
        highAt: now,
        windowStart: now,
        windowEnd: now,
        collectedAt: now,
      });
      const athRows = HistoricalHighModel.getAllForTimeframe('ATH').filter(r =>
        r.symbol.startsWith('TESTHIGHSYM'),
      );
      expect(athRows.length).toBeGreaterThanOrEqual(2);
      for (const r of athRows) expect(r.timeframe).toBe('ATH');
      console.log(`[getAllForTimeframe] ATH test rows: ${athRows.length}`);
    });
  });

  describe('deleteSymbol', () => {
    it('removes all 5-timeframe rows for a symbol in one call', () => {
      const sym = 'TESTHIGHSYMDELUSDT';
      const now = Date.now();
      for (const tf of ALL_TIMEFRAMES) {
        HistoricalHighModel.upsertHigh({
          symbol: sym,
          timeframe: tf,
          highPrice: 1.0,
          highAt: now,
          windowStart: now,
          windowEnd: now,
          collectedAt: now,
        });
      }
      const before = HistoricalHighModel.getAllHighsForSymbol(sym);
      const nonNullBefore = ALL_TIMEFRAMES.filter(tf => before[tf] !== null).length;
      expect(nonNullBefore).toBe(5);

      const deleted = HistoricalHighModel.deleteSymbol(sym);
      expect(deleted).toBe(5);

      const after = HistoricalHighModel.getAllHighsForSymbol(sym);
      for (const tf of ALL_TIMEFRAMES) {
        expect(after[tf]).toBeNull();
      }
      console.log(`[deleteSymbol] purged ${deleted} rows for ${sym}`);
    });

    it('returns 0 when symbol has no rows', () => {
      const deleted = HistoricalHighModel.deleteSymbol('TESTHIGHSYM_NO_SUCH_USDT');
      expect(deleted).toBe(0);
    });
  });

  describe('getCachedSymbols + getStats', () => {
    it('getCachedSymbols contains the test symbols we inserted', () => {
      const all = HistoricalHighModel.getCachedSymbols();
      const testOnes = all.filter(s => s.startsWith('TESTHIGHSYM'));
      expect(testOnes.length).toBeGreaterThan(0);
      console.log(`[getCachedSymbols] total=${all.length}  test-prefixed=${testOnes.length}`);
    });

    it('getStats returns consistent counts', () => {
      const s = HistoricalHighModel.getStats();
      expect(s.rows).toBeGreaterThanOrEqual(0);
      expect(s.symbols).toBeGreaterThanOrEqual(0);
      expect(s.symbols).toBeLessThanOrEqual(s.rows);
      if (s.rows > 0) {
        expect(s.oldestCollectedAt).not.toBeNull();
        expect(s.newestCollectedAt).not.toBeNull();
        expect(s.oldestCollectedAt! <= s.newestCollectedAt!).toBe(true);
      }
      console.log(`[getStats] rows=${s.rows} symbols=${s.symbols} oldest=${s.oldestCollectedAt} newest=${s.newestCollectedAt}`);
    });
  });
});
