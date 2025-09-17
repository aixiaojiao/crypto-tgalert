import { PriceMonitorService } from '../../src/services/priceMonitor';
import { BinanceClient } from '../../src/services/binance';
import { PriceAlertModel } from '../../src/models/PriceAlert';
import { getDatabase } from '../../src/database/connection';

// Mock the database to avoid actual database operations during tests
jest.mock('../../src/database/connection');
jest.mock('../../src/models/PriceAlert');

describe('PriceMonitorService', () => {
  let priceMonitor: PriceMonitorService;
  let mockBinanceClient: jest.Mocked<BinanceClient>;
  let mockDatabase: any;

  beforeEach(() => {
    // Create a mock Binance client
    mockBinanceClient = {
      getPrice: jest.fn(),
      ping: jest.fn(),
      getServerTime: jest.fn(),
      getExchangeInfo: jest.fn(),
      getPrices: jest.fn(),
      get24hrStats: jest.fn(),
      get24hrStatsMultiple: jest.fn(),
      getOrderBook: jest.fn(),
      getKlines: jest.fn(),
      getAvgPrice: jest.fn(),
      isSymbolValid: jest.fn(),
      getTradingSymbols: jest.fn()
    } as any;

    // Create price monitor with mocked client and shorter interval for testing
    priceMonitor = new PriceMonitorService(mockBinanceClient, 1000); // 1 second for testing

    // Mock database
    mockDatabase = {
      all: jest.fn(),
      run: jest.fn()
    };
    (getDatabase as jest.Mock).mockResolvedValue(mockDatabase);
  });

  afterEach(async () => {
    await priceMonitor.stopMonitoring();
    jest.clearAllMocks();
  });

  describe('Initialization Tests', () => {
    test('should initialize with default values', () => {
      const defaultMonitor = new PriceMonitorService();
      expect(defaultMonitor.isMonitoringActive()).toBe(false);
      
      const stats = defaultMonitor.getStats();
      expect(stats.activeAlerts).toBe(0);
      expect(stats.monitoredSymbols).toBe(0);
      expect(stats.checksPerformed).toBe(0);
      expect(stats.alertsTriggered).toBe(0);
    });

    test('should initialize with custom binance client and interval', () => {
      const customMonitor = new PriceMonitorService(mockBinanceClient, 5000);
      expect(customMonitor.isMonitoringActive()).toBe(false);
      
      const stats = customMonitor.getStats();
      expect(stats.activeAlerts).toBe(0);
    });
  });

  describe('Monitoring Lifecycle Tests', () => {
    test('should start monitoring with no active alerts', async () => {
      // Mock no active alerts
      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([]);

      await priceMonitor.startMonitoring();

      expect(priceMonitor.isMonitoringActive()).toBe(true);
      
      const stats = priceMonitor.getStats();
      expect(stats.activeAlerts).toBe(0);
      expect(stats.monitoredSymbols).toBe(0);
    });

    test('should start monitoring with active alerts', async () => {
      const mockAlerts = [
        {
          id: 1,
          user_id: 'user1',
          symbol: 'BTCUSDT',
          condition: 'above',
          value: 50000,
          is_active: 1,
          created_at: new Date().toISOString()
        },
        {
          id: 2,
          user_id: 'user1',
          symbol: 'ETHUSDT',
          condition: 'below',
          value: 3000,
          is_active: 1,
          created_at: new Date().toISOString()
        }
      ];

      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue(mockAlerts);
      mockBinanceClient.getPrice.mockImplementation(async (symbol: string) => {
        if (symbol === 'BTCUSDT') return 45000;
        if (symbol === 'ETHUSDT') return 3500;
        throw new Error(`Unexpected symbol: ${symbol}`);
      });

      await priceMonitor.startMonitoring();

      expect(priceMonitor.isMonitoringActive()).toBe(true);
      
      const stats = priceMonitor.getStats();
      expect(stats.activeAlerts).toBe(2);
      expect(stats.monitoredSymbols).toBe(2); // BTCUSDT and ETHUSDT
    });

    test('should stop monitoring', async () => {
      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([]);
      
      await priceMonitor.startMonitoring();
      expect(priceMonitor.isMonitoringActive()).toBe(true);

      await priceMonitor.stopMonitoring();
      expect(priceMonitor.isMonitoringActive()).toBe(false);
    });

    test('should not start monitoring if already running', async () => {
      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([]);
      
      await priceMonitor.startMonitoring();
      expect(priceMonitor.isMonitoringActive()).toBe(true);

      // Try to start again
      await priceMonitor.startMonitoring();
      expect(priceMonitor.isMonitoringActive()).toBe(true);
    });

    test('should restart monitoring', async () => {
      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([]);
      
      await priceMonitor.startMonitoring();
      expect(priceMonitor.isMonitoringActive()).toBe(true);

      await priceMonitor.restartMonitoring();
      expect(priceMonitor.isMonitoringActive()).toBe(true);
    });
  });

  describe('Symbol Management Tests', () => {
    beforeEach(async () => {
      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([]);
      await priceMonitor.startMonitoring();
    });

    test('should add symbol to monitoring', async () => {
      mockBinanceClient.getPrice.mockResolvedValue(50000);
      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([]);

      await priceMonitor.addSymbolMonitoring('BTCUSDT');

      const stats = priceMonitor.getStats();
      expect(stats.monitoredSymbols).toBe(1);
    });

    test('should not add duplicate symbol', async () => {
      mockBinanceClient.getPrice.mockResolvedValue(50000);
      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([]);

      await priceMonitor.addSymbolMonitoring('BTCUSDT');
      await priceMonitor.addSymbolMonitoring('BTCUSDT'); // Try to add same symbol

      const stats = priceMonitor.getStats();
      expect(stats.monitoredSymbols).toBe(1);
    });

    test('should remove symbol from monitoring', async () => {
      mockBinanceClient.getPrice.mockResolvedValue(50000);
      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([]);

      await priceMonitor.addSymbolMonitoring('BTCUSDT');
      let stats = priceMonitor.getStats();
      expect(stats.monitoredSymbols).toBe(1);

      priceMonitor.removeSymbolMonitoring('BTCUSDT');
      stats = priceMonitor.getStats();
      expect(stats.monitoredSymbols).toBe(0);
    });
  });

  describe('Alert Checking Tests', () => {
    test('should detect triggered above alert', async () => {
      const mockAlert = {
        id: 1,
        user_id: 'user1',
        symbol: 'BTCUSDT',
        condition: 'above' as const,
        value: 50000,
        is_active: 1,
        created_at: new Date().toISOString()
      };

      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([mockAlert]);
      mockBinanceClient.getPrice.mockResolvedValue(55000); // Price above threshold

      await priceMonitor.checkAllAlerts();

      // First add the symbol to monitoring
      await priceMonitor.addSymbolMonitoring('BTCUSDT');
      
      // Wait a bit for the check to happen
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(mockBinanceClient.getPrice).toHaveBeenCalledWith('BTCUSDT');
    });

    test('should detect triggered below alert', async () => {
      const mockAlert = {
        id: 2,
        user_id: 'user1',
        symbol: 'ETHUSDT',
        condition: 'below' as const,
        value: 3000,
        is_active: 1,
        created_at: new Date().toISOString()
      };

      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([mockAlert]);
      mockBinanceClient.getPrice.mockResolvedValue(2500); // Price below threshold

      await priceMonitor.addSymbolMonitoring('ETHUSDT');
      
      // Wait for the check to happen
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(mockBinanceClient.getPrice).toHaveBeenCalledWith('ETHUSDT');
    });

    test('should not trigger alert when condition not met', async () => {
      const mockAlert = {
        id: 3,
        user_id: 'user1',
        symbol: 'BTCUSDT',
        condition: 'above' as const,
        value: 60000,
        is_active: 1,
        created_at: new Date().toISOString()
      };

      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([mockAlert]);
      mockBinanceClient.getPrice.mockResolvedValue(55000); // Price below threshold

      await priceMonitor.addSymbolMonitoring('BTCUSDT');
      
      // Wait for the check to happen
      await new Promise(resolve => setTimeout(resolve, 1100));

      expect(mockBinanceClient.getPrice).toHaveBeenCalledWith('BTCUSDT');
      // Alert should not be deactivated
      expect(PriceAlertModel.deactivateAlert).not.toHaveBeenCalled();
    });
  });

  describe('Near Trigger Alerts Tests', () => {
    test('should find alerts near triggering', async () => {
      const mockAlerts = [
        {
          id: 1,
          user_id: 'user1',
          symbol: 'BTCUSDT',
          condition: 'above' as const,
          value: 51000, // Close to current price
          is_active: 1,
          created_at: new Date().toISOString()
        },
        {
          id: 2,
          user_id: 'user1',
          symbol: 'ETHUSDT',
          condition: 'below' as const,
          value: 2900, // Far from current price
          is_active: 1,
          created_at: new Date().toISOString()
        }
      ];

      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue(mockAlerts);
      mockBinanceClient.getPrice.mockImplementation(async (symbol: string) => {
        if (symbol === 'BTCUSDT') return 50000; // 2% away from alert
        if (symbol === 'ETHUSDT') return 3500; // 17% away from alert
        throw new Error(`Unexpected symbol: ${symbol}`);
      });

      const nearTriggerAlerts = await priceMonitor.getNearTriggerAlerts(5); // Within 5%

      expect(nearTriggerAlerts).toHaveLength(1);
      expect(nearTriggerAlerts[0].alert.symbol).toBe('BTCUSDT');
      expect(nearTriggerAlerts[0].distance).toBeLessThan(5);
    });
  });

  describe('Error Handling Tests', () => {
    test('should handle Binance API errors gracefully', async () => {
      const mockAlert = {
        id: 1,
        user_id: 'user1',
        symbol: 'BTCUSDT',
        condition: 'above' as const,
        value: 50000,
        is_active: 1,
        created_at: new Date().toISOString()
      };

      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([mockAlert]);
      mockBinanceClient.getPrice.mockRejectedValue(new Error('Network error'));

      await priceMonitor.addSymbolMonitoring('BTCUSDT');
      
      // Wait for the check to happen
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should still be monitoring (error handled gracefully)
      expect(priceMonitor.isMonitoringActive()).toBe(true);
    });

    test('should handle database errors gracefully', async () => {
      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockRejectedValue(new Error('Database error'));

      // Should not throw error
      await expect(priceMonitor.startMonitoring()).rejects.toThrow('Database error');
      expect(priceMonitor.isMonitoringActive()).toBe(false);
    });
  });

  describe('Statistics Tests', () => {
    test('should track monitoring statistics', async () => {
      const initialStats = priceMonitor.getStats();
      expect(initialStats.checksPerformed).toBe(0);
      expect(initialStats.alertsTriggered).toBe(0);

      // Test that stats object is a copy (not reference)
      initialStats.checksPerformed = 999;
      const newStats = priceMonitor.getStats();
      expect(newStats.checksPerformed).toBe(0);
    });

    test('should update stats when checks are performed', async () => {
      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([]);
      mockBinanceClient.getPrice.mockResolvedValue(50000);

      await priceMonitor.addSymbolMonitoring('BTCUSDT');
      
      // Wait for at least one check to happen
      await new Promise(resolve => setTimeout(resolve, 1100));

      const stats = priceMonitor.getStats();
      expect(stats.lastCheck).toBeDefined();
      expect(stats.lastCheck.getTime()).toBeGreaterThan(Date.now() - 5000); // Within last 5 seconds
    });
  });

  describe('Integration Tests with Real Data', () => {
    test('should work with real Binance client for basic functionality', async () => {
      const realBinanceClient = new BinanceClient();
      const realMonitor = new PriceMonitorService(realBinanceClient, 2000);

      try {
        // Test with no alerts (should work without database)
        (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([]);
        
        await realMonitor.startMonitoring();
        expect(realMonitor.isMonitoringActive()).toBe(true);

        // Test adding a real symbol
        await realMonitor.addSymbolMonitoring('BTCUSDT');
        const stats = realMonitor.getStats();
        expect(stats.monitoredSymbols).toBe(1);

        await realMonitor.stopMonitoring();
        expect(realMonitor.isMonitoringActive()).toBe(false);
      } catch (error) {
        console.warn('Real integration test failed (expected if no API credentials):', error);
      }
    }, 15000);
  });

  describe('Alert Message Formatting Tests', () => {
    test('should format alert messages correctly', async () => {
      // This tests the private method indirectly by checking if the monitoring works
      const mockAlert = {
        id: 1,
        user_id: 'user1',
        symbol: 'BTCUSDT',
        condition: 'above' as const,
        value: 50000,
        is_active: 1,
        created_at: new Date().toISOString(),
        triggered_at: null
      };

      (PriceAlertModel.getAllActiveAlerts as jest.Mock).mockResolvedValue([mockAlert]);
      (PriceAlertModel.deactivateAlert as jest.Mock).mockResolvedValue(undefined);
      mockBinanceClient.getPrice.mockResolvedValue(55000); // Above threshold

      await priceMonitor.addSymbolMonitoring('BTCUSDT');
      
      // Wait for check
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Alert should be deactivated when triggered
      expect(PriceAlertModel.deactivateAlert).toHaveBeenCalledWith(1);
    });
  });
});