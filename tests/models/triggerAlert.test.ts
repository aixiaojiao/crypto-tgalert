import { TriggerAlertModel, GainersRanking, FundingRanking } from '../../src/models/TriggerAlert';
import { getDatabase } from '../../src/database/connection';

// Mock the database connection
jest.mock('../../src/database/connection');

describe('TriggerAlertModel', () => {
  let mockDb: any;
  let mockStmt: any;

  beforeEach(() => {
    mockStmt = {
      run: jest.fn(),
      all: jest.fn(),
      get: jest.fn(),
      finalize: jest.fn()
    };

    mockDb = {
      exec: jest.fn(),
      prepare: jest.fn().mockResolvedValue(mockStmt),
      close: jest.fn()
    };

    (getDatabase as jest.Mock).mockResolvedValue(mockDb);
    jest.clearAllMocks();
  });

  describe('Database Table Initialization', () => {
    test('should initialize all required tables', async () => {
      await TriggerAlertModel.initializeTables();

      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS gainers_rankings')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS funding_rankings')
      );
      expect(mockDb.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS trigger_alert_settings')
      );
    });

    test('should create proper indexes', async () => {
      await TriggerAlertModel.initializeTables();

      const execCall = mockDb.exec.mock.calls[0][0];
      expect(execCall).toContain('CREATE INDEX IF NOT EXISTS idx_gainers_timestamp');
      expect(execCall).toContain('CREATE INDEX IF NOT EXISTS idx_funding_timestamp');
      expect(execCall).toContain('CREATE INDEX IF NOT EXISTS idx_trigger_settings_user');
    });
  });

  describe('Rankings Persistence', () => {
    test('should save gainers rankings with proper resource cleanup', async () => {
      const rankings: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 10.5 },
        { symbol: 'ETHUSDT', position: 2, price_change_percent: 8.2 }
      ];

      await TriggerAlertModel.saveGainersRankings(rankings);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO gainers_rankings')
      );
      expect(mockStmt.run).toHaveBeenCalledTimes(2);
      expect(mockStmt.run).toHaveBeenCalledWith('BTCUSDT', 1, 10.5);
      expect(mockStmt.run).toHaveBeenCalledWith('ETHUSDT', 2, 8.2);
      expect(mockStmt.finalize).toHaveBeenCalled();
    });

    test('should save funding rankings with proper resource cleanup', async () => {
      const rankings: FundingRanking[] = [
        { symbol: 'BTCUSDT', position: 1, funding_rate: -0.0001, funding_rate_8h: -0.0001 },
        { symbol: 'ETHUSDT', position: 2, funding_rate: -0.0002, funding_rate_8h: -0.0002 }
      ];

      await TriggerAlertModel.saveFundingRankings(rankings);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO funding_rankings')
      );
      expect(mockStmt.run).toHaveBeenCalledTimes(2);
      expect(mockStmt.run).toHaveBeenCalledWith('BTCUSDT', 1, -0.0001, -0.0001);
      expect(mockStmt.run).toHaveBeenCalledWith('ETHUSDT', 2, -0.0002, -0.0002);
      expect(mockStmt.finalize).toHaveBeenCalled();
    });

    test('should cleanup resources on error in saveGainersRankings', async () => {
      const rankings: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 10.5 }
      ];

      mockStmt.run.mockRejectedValueOnce(new Error('Database error'));

      await expect(TriggerAlertModel.saveGainersRankings(rankings))
        .rejects.toThrow('Database error');

      expect(mockStmt.finalize).toHaveBeenCalled();
    });

    test('should cleanup resources on error in saveFundingRankings', async () => {
      const rankings: FundingRanking[] = [
        { symbol: 'BTCUSDT', position: 1, funding_rate: -0.0001, funding_rate_8h: -0.0001 }
      ];

      mockStmt.run.mockRejectedValueOnce(new Error('Database error'));

      await expect(TriggerAlertModel.saveFundingRankings(rankings))
        .rejects.toThrow('Database error');

      expect(mockStmt.finalize).toHaveBeenCalled();
    });
  });

  describe('Previous Rankings Retrieval - Bug Fix Tests', () => {
    test('should return empty array when insufficient historical data for gainers', async () => {
      // Mock count query to return less than 2 timestamps
      mockStmt.get.mockResolvedValueOnce({ distinct_timestamps: 1 });

      const result = await TriggerAlertModel.getPreviousGainersRankings();

      expect(result).toEqual([]);
      expect(mockStmt.finalize).toHaveBeenCalledTimes(1); // Only count query finalize
    });

    test('should return empty array when insufficient historical data for funding', async () => {
      // Mock count query to return less than 2 timestamps
      mockStmt.get.mockResolvedValueOnce({ distinct_timestamps: 0 });

      const result = await TriggerAlertModel.getPreviousFundingRankings();

      expect(result).toEqual([]);
      expect(mockStmt.finalize).toHaveBeenCalledTimes(1); // Only count query finalize
    });

    test('should use row-based query when sufficient data exists for gainers', async () => {
      // Mock count query to return sufficient timestamps
      mockStmt.get.mockResolvedValueOnce({ distinct_timestamps: 3 });
      
      const mockRankings = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 9.5 },
        { symbol: 'ETHUSDT', position: 2, price_change_percent: 7.2 }
      ];
      mockStmt.all.mockResolvedValueOnce(mockRankings);

      const result = await TriggerAlertModel.getPreviousGainersRankings();

      expect(result).toEqual(mockRankings);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WITH ranked_timestamps AS')
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ROW_NUMBER() OVER (ORDER BY timestamp DESC)')
      );
      expect(mockStmt.finalize).toHaveBeenCalledTimes(2); // Both queries finalized
    });

    test('should use row-based query when sufficient data exists for funding', async () => {
      // Mock count query to return sufficient timestamps
      mockStmt.get.mockResolvedValueOnce({ distinct_timestamps: 5 });
      
      const mockRankings = [
        { symbol: 'BTCUSDT', position: 1, funding_rate: -0.0001, funding_rate_8h: -0.0001 },
        { symbol: 'ETHUSDT', position: 2, funding_rate: -0.0002, funding_rate_8h: -0.0002 }
      ];
      mockStmt.all.mockResolvedValueOnce(mockRankings);

      const result = await TriggerAlertModel.getPreviousFundingRankings();

      expect(result).toEqual(mockRankings);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WITH ranked_timestamps AS')
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('second_latest_timestamp AS')
      );
      expect(mockStmt.finalize).toHaveBeenCalledTimes(2); // Both queries finalized
    });

    test('should handle database errors gracefully in getPreviousGainersRankings', async () => {
      mockStmt.get.mockRejectedValueOnce(new Error('Database connection failed'));

      const result = await TriggerAlertModel.getPreviousGainersRankings();

      expect(result).toEqual([]);
    });

    test('should handle database errors gracefully in getPreviousFundingRankings', async () => {
      mockStmt.get.mockRejectedValueOnce(new Error('Database connection failed'));

      const result = await TriggerAlertModel.getPreviousFundingRankings();

      expect(result).toEqual([]);
    });
  });

  describe('Latest Rankings Retrieval', () => {
    test('should get latest gainers rankings', async () => {
      const mockRankings = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 10.5 },
        { symbol: 'ETHUSDT', position: 2, price_change_percent: 8.2 }
      ];
      mockStmt.all.mockResolvedValueOnce(mockRankings);

      const result = await TriggerAlertModel.getLatestGainersRankings();

      expect(result).toEqual(mockRankings);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE timestamp = (SELECT MAX(timestamp)')
      );
    });

    test('should get latest funding rankings', async () => {
      const mockRankings = [
        { symbol: 'BTCUSDT', position: 1, funding_rate: -0.0001, funding_rate_8h: -0.0001 }
      ];
      mockStmt.all.mockResolvedValueOnce(mockRankings);

      const result = await TriggerAlertModel.getLatestFundingRankings();

      expect(result).toEqual(mockRankings);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE timestamp = (SELECT MAX(timestamp)')
      );
    });
  });

  describe('User Settings Management', () => {
    test('should set trigger alert settings for user', async () => {
      await TriggerAlertModel.setTriggerAlert('123456789', 'gainers', true);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO trigger_alert_settings')
      );
      expect(mockStmt.run).toHaveBeenCalledWith('123456789', 'gainers', 1);
      expect(mockStmt.finalize).toHaveBeenCalled();
    });

    test('should get enabled users for alert type', async () => {
      const mockUsers = [
        { user_id: '123456789' },
        { user_id: '987654321' }
      ];
      mockStmt.all.mockResolvedValueOnce(mockUsers);

      const result = await TriggerAlertModel.getEnabledUsers('gainers');

      expect(result).toEqual(['123456789', '987654321']);
      expect(mockStmt.all).toHaveBeenCalledWith('gainers');
    });

    test('should get trigger alert settings for user', async () => {
      const mockSettings = [
        { user_id: '123456789', alert_type: 'gainers', is_enabled: 1 },
        { user_id: '123456789', alert_type: 'funding', is_enabled: 0 }
      ];
      mockStmt.all.mockResolvedValueOnce(mockSettings);

      const result = await TriggerAlertModel.getTriggerAlertSettings('123456789');

      expect(result).toHaveLength(2);
      expect(result[0].is_enabled).toBe(true);
      expect(result[1].is_enabled).toBe(false);
    });
  });

  describe('Data Cleanup', () => {
    test('should clean old data from both tables', async () => {
      const mockResult = { changes: 5 };
      mockStmt.run.mockResolvedValue(mockResult);

      await TriggerAlertModel.cleanOldData();

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM gainers_rankings WHERE timestamp < datetime('now', '-7 days')")
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM funding_rankings WHERE timestamp < datetime('now', '-7 days')")
      );
      expect(mockStmt.finalize).toHaveBeenCalledTimes(2);
    });
  });

  describe('compareRankings Static Method - Edge Cases', () => {
    test('should handle empty current rankings', () => {
      const current: GainersRanking[] = [];
      const previous: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 10.5 }
      ];

      const result = TriggerAlertModel.compareRankings(current, previous);

      expect(result).toEqual([]);
    });

    test('should handle both empty arrays', () => {
      const current: GainersRanking[] = [];
      const previous: GainersRanking[] = [];

      const result = TriggerAlertModel.compareRankings(current, previous);

      expect(result).toEqual([]);
    });

    test('should handle large position changes correctly', () => {
      const current: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 15.5 }
      ];
      const previous: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 10, price_change_percent: 5.5 }
      ];

      const result = TriggerAlertModel.compareRankings(current, previous);

      expect(result).toHaveLength(1);
      expect(result[0].change).toBe('up');
      expect(result[0].changeValue).toBe(9); // from 10 to 1
    });

    test('should handle symbols disappearing from rankings', () => {
      const current: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 15.5 }
      ];
      const previous: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 15.5 },
        { symbol: 'ETHUSDT', position: 2, price_change_percent: 8.2 }
      ];

      const result = TriggerAlertModel.compareRankings(current, previous);

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe('BTCUSDT');
      // ETHUSDT disappears but doesn't appear in changes since it's not in current
    });
  });
});