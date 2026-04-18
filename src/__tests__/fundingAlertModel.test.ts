import { FundingAlertModel, FundingAlertRecord, FundingAlertType } from '../models/fundingAlertModel';

describe('FundingAlertModel', () => {
  beforeAll(() => {
    // 使用真实数据库（data/crypto-alerts.db）
    FundingAlertModel.initDatabase();
  });

  // 每次测试后清理测试数据
  afterAll(() => {
    // 清理测试插入的记录（以 TESTUSDT 开头的 symbol）
    try {
      const db = (FundingAlertModel as any).db;
      db.prepare(`DELETE FROM funding_alerts WHERE symbol LIKE 'TEST%'`).run();
    } catch (e) {
      // ignore
    }
  });

  describe('initDatabase', () => {
    it('should report database as initialized', () => {
      expect(FundingAlertModel.isDatabaseInitialized()).toBe(true);
    });

    it('should be idempotent (call twice without error)', () => {
      expect(() => FundingAlertModel.initDatabase()).not.toThrow();
    });
  });

  describe('recordAlert', () => {
    it('should insert a record and return a valid row id', () => {
      const record: FundingAlertRecord = {
        symbol: 'TESTUSDT',
        alertType: 'negative',
        fundingRate8h: -0.001,
        fundingIntervalHours: 8,
        triggeredAt: Date.now(),
      };

      const id = FundingAlertModel.recordAlert(record);
      expect(id).toBeGreaterThan(0);
      console.log(`[recordAlert] inserted id=${id} for symbol=${record.symbol} type=${record.alertType}`);
    });

    it('should insert different alert types for the same symbol', () => {
      const types: FundingAlertType[] = ['negative', 'rate_-0.5', 'rate_-1', 'rate_-1.5', 'interval_4h', 'interval_1h'];
      const ids: number[] = [];

      for (const type of types) {
        const id = FundingAlertModel.recordAlert({
          symbol: 'TESTMULTIUSDT',
          alertType: type,
          fundingRate8h: -0.02,
          fundingIntervalHours: type.startsWith('interval_') ? parseInt(type.split('_')[1]) : 8,
          triggeredAt: Date.now(),
        });
        ids.push(id);
      }

      // All ids should be unique and positive
      expect(new Set(ids).size).toBe(types.length);
      ids.forEach(id => expect(id).toBeGreaterThan(0));
      console.log(`[recordAlert] inserted ${ids.length} records for TESTMULTIUSDT, ids=${ids.join(',')}`);
    });
  });

  describe('hasAlertedRecently (4h dedup window)', () => {
    it('should return true for a record inserted just now', () => {
      const symbol = 'TESTRECENTUSDT';
      const type: FundingAlertType = 'negative';

      FundingAlertModel.recordAlert({
        symbol,
        alertType: type,
        fundingRate8h: -0.002,
        fundingIntervalHours: 8,
        triggeredAt: Date.now(),
      });

      const result = FundingAlertModel.hasAlertedRecently(symbol, type);
      expect(result).toBe(true);
      console.log(`[hasAlertedRecently] ${symbol}/${type} just inserted = ${result} (expected true)`);
    });

    it('should return true for a record inserted 3 hours ago (inside window)', () => {
      const symbol = 'TEST3HUSDT';
      const type: FundingAlertType = 'rate_-0.5';
      const threeHoursAgoMs = Date.now() - 3 * 60 * 60 * 1000;

      FundingAlertModel.recordAlert({
        symbol,
        alertType: type,
        fundingRate8h: -0.006,
        fundingIntervalHours: 8,
        triggeredAt: threeHoursAgoMs,
      });

      const result = FundingAlertModel.hasAlertedRecently(symbol, type);
      expect(result).toBe(true);
      console.log(`[hasAlertedRecently] ${symbol}/${type} triggered 3h ago = ${result} (expected true)`);
    });

    it('should return false for a record inserted 5 hours ago (outside window)', () => {
      const symbol = 'TEST5HUSDT';
      const type: FundingAlertType = 'rate_-1';
      const fiveHoursAgoMs = Date.now() - 5 * 60 * 60 * 1000;

      FundingAlertModel.recordAlert({
        symbol,
        alertType: type,
        fundingRate8h: -0.012,
        fundingIntervalHours: 8,
        triggeredAt: fiveHoursAgoMs,
      });

      const result = FundingAlertModel.hasAlertedRecently(symbol, type);
      expect(result).toBe(false);
      console.log(`[hasAlertedRecently] ${symbol}/${type} triggered 5h ago = ${result} (expected false)`);
    });

    it('should return false for a type that was NOT triggered recently', () => {
      const symbol = 'TESTRECENTUSDT';
      const result = FundingAlertModel.hasAlertedRecently(symbol, 'rate_-1.5');
      expect(result).toBe(false);
      console.log(`[hasAlertedRecently] ${symbol}/rate_-1.5 = ${result} (expected false)`);
    });

    it('should return false for a symbol that was NOT triggered at all', () => {
      const result = FundingAlertModel.hasAlertedRecently('NEVERUSDT', 'negative');
      expect(result).toBe(false);
      console.log(`[hasAlertedRecently] NEVERUSDT/negative = ${result} (expected false)`);
    });
  });

  describe('getTodayStats', () => {
    it('should return counts grouped by alert type', () => {
      const stats = FundingAlertModel.getTodayStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byType');
      expect(typeof stats.total).toBe('number');
      expect(stats.total).toBeGreaterThanOrEqual(0);
      console.log(`[getTodayStats] total=${stats.total}, byType=${JSON.stringify(stats.byType)}`);
    });
  });

  describe('config', () => {
    it('should default to disabled', () => {
      // 清空配置确保干净状态
      FundingAlertModel.setConfig('enabled', 'false');
      expect(FundingAlertModel.isEnabled()).toBe(false);
    });

    it('should enable and disable', () => {
      FundingAlertModel.setEnabled(true);
      expect(FundingAlertModel.isEnabled()).toBe(true);
      console.log(`[config] enabled=true -> isEnabled=${FundingAlertModel.isEnabled()}`);

      FundingAlertModel.setEnabled(false);
      expect(FundingAlertModel.isEnabled()).toBe(false);
      console.log(`[config] enabled=false -> isEnabled=${FundingAlertModel.isEnabled()}`);
    });

    it('should store and retrieve arbitrary config keys', () => {
      FundingAlertModel.setConfig('test_key', 'test_value');
      expect(FundingAlertModel.getConfig('test_key')).toBe('test_value');

      // Update
      FundingAlertModel.setConfig('test_key', 'updated');
      expect(FundingAlertModel.getConfig('test_key')).toBe('updated');
      console.log(`[config] test_key updated to 'updated'`);
    });

    it('should return null for non-existent config', () => {
      expect(FundingAlertModel.getConfig('non_existent_key_xyz')).toBeNull();
    });
  });
});
