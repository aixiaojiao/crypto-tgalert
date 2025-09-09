import { TriggerAlertService } from '../../src/services/triggerAlerts';
import { TriggerAlertModel, GainersRanking, FundingRanking, RankingChange } from '../../src/models/TriggerAlert';
import { BinanceClient } from '../../src/services/binance';
import { TelegramBot } from '../../src/bot';

// Mock dependencies
jest.mock('../../src/models/TriggerAlert');
jest.mock('../../src/services/binance');
jest.mock('../../src/bot');
jest.mock('../../src/config/tokenLists', () => ({
  filterTradingPairs: jest.fn((symbols) => symbols),
  getTokenRiskLevel: jest.fn(() => 'safe'),
  getRiskIcon: jest.fn(() => '✅')
}));

// Import the actual compareRankings implementation
import { TriggerAlertModel as ActualTriggerAlertModel } from '../../src/models/TriggerAlert';

describe('TriggerAlertService', () => {
  let triggerService: TriggerAlertService;
  let mockBinanceClient: jest.Mocked<BinanceClient>;
  let mockTelegramBot: jest.Mocked<TelegramBot>;

  beforeEach(() => {
    jest.useFakeTimers();
    
    mockBinanceClient = {
      getFutures24hrStatsMultiple: jest.fn(),
      getAllFundingRates: jest.fn()
    } as any;

    mockTelegramBot = {
      sendMessage: jest.fn()
    } as any;

    triggerService = new TriggerAlertService(mockBinanceClient, mockTelegramBot);
    
    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    triggerService.stopAllMonitoring();
    
    // Clear any remaining timers to prevent Jest hanging
    jest.clearAllTimers();
    jest.runOnlyPendingTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('compareRankings - Core Logic Tests', () => {
    test('should detect new symbols correctly', () => {
      const current: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 10.5 },
        { symbol: 'ETHUSDT', position: 2, price_change_percent: 8.2 },
        { symbol: 'NEWUSDT', position: 3, price_change_percent: 7.1 }
      ];

      const previous: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 9.5 },
        { symbol: 'ETHUSDT', position: 3, price_change_percent: 6.2 }
      ];

      const changes = ActualTriggerAlertModel.compareRankings(current, previous);
      
      expect(changes).toHaveLength(3);
      
      const newSymbolChange = changes.find(c => c.symbol === 'NEWUSDT');
      expect(newSymbolChange).toBeDefined();
      expect(newSymbolChange?.change).toBe('new');
      expect(newSymbolChange?.previousPosition).toBeUndefined();
    });

    test('should detect position changes correctly', () => {
      const current: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 10.5 },
        { symbol: 'ETHUSDT', position: 2, price_change_percent: 8.2 },
        { symbol: 'ADAUSDT', position: 3, price_change_percent: 7.1 }
      ];

      const previous: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 2, price_change_percent: 9.5 },
        { symbol: 'ETHUSDT', position: 1, price_change_percent: 6.2 },
        { symbol: 'ADAUSDT', position: 5, price_change_percent: 5.1 }
      ];

      const changes = ActualTriggerAlertModel.compareRankings(current, previous);
      
      const btcChange = changes.find(c => c.symbol === 'BTCUSDT');
      expect(btcChange?.change).toBe('up');
      expect(btcChange?.changeValue).toBe(1); // moved from 2 to 1
      
      const ethChange = changes.find(c => c.symbol === 'ETHUSDT');
      expect(ethChange?.change).toBe('down');
      expect(ethChange?.changeValue).toBe(1); // moved from 1 to 2
      
      const adaChange = changes.find(c => c.symbol === 'ADAUSDT');
      expect(adaChange?.change).toBe('up');
      expect(adaChange?.changeValue).toBe(2); // moved from 5 to 3
    });

    test('should handle same positions correctly', () => {
      const current: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 10.5 }
      ];

      const previous: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 9.5 }
      ];

      const changes = ActualTriggerAlertModel.compareRankings(current, previous);
      
      expect(changes).toHaveLength(1);
      expect(changes[0].change).toBe('same');
      expect(changes[0].changeValue).toBeUndefined();
    });

    test('should handle empty previous rankings', () => {
      const current: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 10.5 },
        { symbol: 'ETHUSDT', position: 2, price_change_percent: 8.2 }
      ];

      const previous: GainersRanking[] = [];

      const changes = ActualTriggerAlertModel.compareRankings(current, previous);
      
      expect(changes).toHaveLength(2);
      changes.forEach(change => {
        expect(change.change).toBe('new');
        expect(change.previousPosition).toBeUndefined();
      });
    });
  });

  describe('False New Symbol Bug Fix Tests', () => {
    beforeEach(() => {
      // Mock successful API responses
      mockBinanceClient.getFutures24hrStatsMultiple.mockResolvedValue([
        { symbol: 'BTCUSDT', priceChangePercent: '10.5' },
        { symbol: 'ETHUSDT', priceChangePercent: '8.2' },
        { symbol: 'NEWUSDT', priceChangePercent: '7.1' }
      ] as any);

      (TriggerAlertModel.getEnabledUsers as jest.Mock).mockResolvedValue(['123456789']);
      (TriggerAlertModel.saveGainersRankings as jest.Mock).mockResolvedValue(undefined);
    });

    test('should not mark existing symbol as new after validation', async () => {
      // Setup: Symbol exists in previous rankings but appears in significantChanges as 'new'
      const previousRankings: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 2, price_change_percent: 9.5 },
        { symbol: 'ETHUSDT', position: 1, price_change_percent: 6.2 },
        { symbol: 'NEWUSDT', position: 4, price_change_percent: 5.1 } // This exists in previous
      ];

      (TriggerAlertModel.getPreviousGainersRankings as jest.Mock).mockResolvedValue(previousRankings);

      // Mock compareRankings to simulate false "new" detection
      const mockChanges: RankingChange[] = [
        { symbol: 'BTCUSDT', currentPosition: 1, previousPosition: 2, change: 'up', changeValue: 1 },
        { symbol: 'ETHUSDT', currentPosition: 2, previousPosition: 1, change: 'down', changeValue: 1 },
        { symbol: 'NEWUSDT', currentPosition: 3, previousPosition: undefined, change: 'new', changeValue: undefined } // False "new"
      ];

      (TriggerAlertModel.compareRankings as jest.Mock).mockReturnValue(mockChanges);

      // Test the checkGainers method via reflection/private method testing
      await (triggerService as any).checkGainers();

      // Verify that sendMessage was NOT called for the false "new" symbol
      expect(mockTelegramBot.sendMessage).not.toHaveBeenCalled();
    });

    test('should properly detect actual new symbols', async () => {
      // Setup: Symbol does NOT exist in previous rankings
      const previousRankings: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 1, price_change_percent: 9.5 },
        { symbol: 'ETHUSDT', position: 2, price_change_percent: 6.2 }
        // NEWUSDT is not in previous rankings
      ];

      (TriggerAlertModel.getPreviousGainersRankings as jest.Mock).mockResolvedValue(previousRankings);

      const mockChanges: RankingChange[] = [
        { symbol: 'BTCUSDT', currentPosition: 1, previousPosition: 1, change: 'same', changeValue: undefined },
        { symbol: 'ETHUSDT', currentPosition: 2, previousPosition: 2, change: 'same', changeValue: undefined },
        { symbol: 'NEWUSDT', currentPosition: 3, previousPosition: undefined, change: 'new', changeValue: undefined } // Actual new
      ];

      (TriggerAlertModel.compareRankings as jest.Mock).mockReturnValue(mockChanges);

      await (triggerService as any).checkGainers();

      // Verify that sendMessage WAS called for the actual new symbol
      expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
        123456789,
        expect.stringContaining('🆕 *新进入前10:* NEW'),
        { parse_mode: 'Markdown' }
      );
    });

    test('should handle major position moves correctly', async () => {
      const previousRankings: GainersRanking[] = [
        { symbol: 'BTCUSDT', position: 8, price_change_percent: 5.5 },
        { symbol: 'ETHUSDT', position: 2, price_change_percent: 6.2 }
      ];

      (TriggerAlertModel.getPreviousGainersRankings as jest.Mock).mockResolvedValue(previousRankings);

      const mockChanges: RankingChange[] = [
        { symbol: 'BTCUSDT', currentPosition: 1, previousPosition: 8, change: 'up', changeValue: 7 }, // Major move
        { symbol: 'ETHUSDT', currentPosition: 2, previousPosition: 2, change: 'same', changeValue: undefined }
      ];

      (TriggerAlertModel.compareRankings as jest.Mock).mockReturnValue(mockChanges);

      await (triggerService as any).checkGainers();

      // Verify notification was sent for major move (5+ positions)
      expect(mockTelegramBot.sendMessage).toHaveBeenCalledWith(
        123456789,
        expect.stringContaining('涨幅榜更新提醒'),
        { parse_mode: 'Markdown' }
      );
    });
  });

  describe('Data Persistence Timing Tests', () => {
    test('should save rankings AFTER notification processing', async () => {
      const saveCallOrder: string[] = [];
      
      // Track the order of calls
      (TriggerAlertModel.saveGainersRankings as jest.Mock).mockImplementation(() => {
        saveCallOrder.push('save');
        return Promise.resolve();
      });

      mockTelegramBot.sendMessage.mockImplementation(() => {
        saveCallOrder.push('send');
        return Promise.resolve();
      });

      mockBinanceClient.getFutures24hrStatsMultiple.mockResolvedValue([
        { symbol: 'BTCUSDT', priceChangePercent: '10.5' }
      ] as any);

      (TriggerAlertModel.getPreviousGainersRankings as jest.Mock).mockResolvedValue([
        { symbol: 'OLDUSDT', position: 1, price_change_percent: 9.5 }
      ]);

      (TriggerAlertModel.getEnabledUsers as jest.Mock).mockResolvedValue(['123456789']);

      const mockChanges: RankingChange[] = [
        { symbol: 'BTCUSDT', currentPosition: 1, previousPosition: undefined, change: 'new', changeValue: undefined }
      ];

      (TriggerAlertModel.compareRankings as jest.Mock).mockReturnValue(mockChanges);

      await (triggerService as any).checkGainers();

      // Verify that notification was sent BEFORE saving
      expect(saveCallOrder).toEqual(['send', 'save']);
    });
  });

  describe('Funding Rate Tests', () => {
    beforeEach(() => {
      mockBinanceClient.getAllFundingRates.mockResolvedValue([
        { symbol: 'BTCUSDT', fundingRate: '-0.0001' },
        { symbol: 'ETHUSDT', fundingRate: '-0.0002' },
        { symbol: 'NEWUSDT', fundingRate: '-0.0003' }
      ] as any);

      (TriggerAlertModel.getEnabledUsers as jest.Mock).mockResolvedValue(['123456789']);
      (TriggerAlertModel.saveFundingRankings as jest.Mock).mockResolvedValue(undefined);
    });

    test('should handle funding rate false new symbols correctly', async () => {
      const previousRankings: FundingRanking[] = [
        { symbol: 'BTCUSDT', position: 1, funding_rate: -0.0001, funding_rate_8h: -0.0001 },
        { symbol: 'NEWUSDT', position: 3, funding_rate: -0.0003, funding_rate_8h: -0.0003 } // Exists
      ];

      (TriggerAlertModel.getPreviousFundingRankings as jest.Mock).mockResolvedValue(previousRankings);

      const mockChanges: RankingChange[] = [
        { symbol: 'NEWUSDT', currentPosition: 1, previousPosition: undefined, change: 'new', changeValue: undefined } // False new
      ];

      (TriggerAlertModel.compareRankings as jest.Mock).mockReturnValue(mockChanges);

      await (triggerService as any).checkFunding();

      // Should not send notification for false new symbol
      expect(mockTelegramBot.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Service Management Tests', () => {
    test('should start and stop gainers monitoring correctly', async () => {
      expect(triggerService.getStats().gainersEnabled).toBe(false);
      
      await triggerService.startGainersMonitoring();
      expect(triggerService.getStats().gainersEnabled).toBe(true);
      expect(triggerService.getStats().gainersInterval).not.toBeNull();
      
      triggerService.stopGainersMonitoring();
      expect(triggerService.getStats().gainersEnabled).toBe(false);
      expect(triggerService.getStats().gainersInterval).toBeNull();
    });

    test('should start and stop funding monitoring correctly', async () => {
      expect(triggerService.getStats().fundingEnabled).toBe(false);
      
      await triggerService.startFundingMonitoring();
      expect(triggerService.getStats().fundingEnabled).toBe(true);
      expect(triggerService.getStats().fundingInterval).not.toBeNull();
      
      triggerService.stopFundingMonitoring();
      expect(triggerService.getStats().fundingEnabled).toBe(false);
      expect(triggerService.getStats().fundingInterval).toBeNull();
    });

    test('should not start monitoring if already enabled', async () => {
      await triggerService.startGainersMonitoring();
      const stats1 = triggerService.getStats();
      
      // Try to start again
      await triggerService.startGainersMonitoring();
      const stats2 = triggerService.getStats();
      
      expect(stats1.gainersInterval).toBe(stats2.gainersInterval);
    });
  });
});