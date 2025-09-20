import { AlertCommandParser } from '../utils/alertParser';
import { BreakthroughDetectionService } from '../services/alerts/BreakthroughDetectionService';
import { AlertType, AlertCondition, AlertPriority } from '../services/alerts/IAlertService';

describe('Breakthrough Alert System', () => {
  describe('AlertCommandParser - Breakthrough Commands', () => {
    test('should parse basic breakthrough command', () => {
      const args = ['breakthrough', 'btc', '1w'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.symbol).toBe('BTC');
      expect(result.type).toBe(AlertType.BREAKTHROUGH);
      expect(result.condition).toBe(AlertCondition.BREAKS_TIMEFRAME_HIGH);
      expect(result.timeframe).toBe('1w');
      expect(result.watchAllSymbols).toBe(false);
      expect(result.priority).toBe(AlertPriority.CRITICAL);
    });

    test('should parse abbreviated breakthrough command', () => {
      const args = ['bt', 'eth', '1m'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.symbol).toBe('ETH');
      expect(result.type).toBe(AlertType.BREAKTHROUGH);
      expect(result.timeframe).toBe('1m');
    });

    test('should parse multi-coin breakthrough command', () => {
      const args = ['breakthrough', 'all', '1y'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.symbol).toBe('ALL');
      expect(result.type).toBe(AlertType.MULTI_BREAKTHROUGH);
      expect(result.watchAllSymbols).toBe(true);
      expect(result.timeframe).toBe('1y');
    });

    test('should parse all-time high breakthrough', () => {
      const args = ['breakthrough', 'btc', 'all'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.condition).toBe(AlertCondition.BREAKS_HIGH);
      expect(result.timeframe).toBe('all');
    });

    test('should throw error for invalid timeframe', () => {
      const args = ['breakthrough', 'btc', '2d'];

      expect(() => {
        AlertCommandParser.parseAlertCommand(args);
      }).toThrow('无效的时间框架: 2d');
    });

    test('should throw error for insufficient args', () => {
      const args = ['breakthrough', 'btc'];

      expect(() => {
        AlertCommandParser.parseAlertCommand(args);
      }).toThrow('突破警报参数不足');
    });

    test('should validate symbol format', () => {
      const args = ['breakthrough', '123', '1w'];

      expect(() => {
        AlertCommandParser.parseAlertCommand(args);
      }).toThrow('无效的交易对符号: 123');
    });
  });

  describe('BreakthroughDetectionService', () => {
    let service: BreakthroughDetectionService;

    beforeEach(() => {
      service = new BreakthroughDetectionService();
    });

    test('should check breakthrough conditions correctly', () => {
      // Test private method through public interface
      const currentPrice = 55000;
      const highPrice = 50000;
      const lastCheckPrice = 49000;

      // This should be a breakthrough: current > high && last <= high
      const result = service['isBreakthroughConditionMet'](currentPrice, highPrice, lastCheckPrice);
      expect(result).toBe(true);
    });

    test('should prevent duplicate breakthrough alerts', () => {
      const currentPrice = 55000;
      const highPrice = 50000;
      const lastCheckPrice = 52000; // Already above high

      // This should NOT be a breakthrough to prevent duplicates
      const result = service['isBreakthroughConditionMet'](currentPrice, highPrice, lastCheckPrice);
      expect(result).toBe(false);
    });

    test('should not trigger when price below high', () => {
      const currentPrice = 48000;
      const highPrice = 50000;
      const lastCheckPrice = 47000;

      const result = service['isBreakthroughConditionMet'](currentPrice, highPrice, lastCheckPrice);
      expect(result).toBe(false);
    });

    test('should generate breakthrough message correctly', () => {
      const result = {
        symbol: 'BTCUSDT',
        currentPrice: 55000,
        timeframeHigh: 50000,
        highTimestamp: Date.now() - 24 * 60 * 60 * 1000, // 1 day ago
        isBreakthrough: true,
        breakAmount: 5000,
        breakPercentage: 10.0
      };

      const message = service.generateBreakthroughMessage(result, '1w', false);

      expect(message).toContain('🚀🚀🚀 **历史突破警报** 🚀🚀🚀');
      expect(message).toContain('BTC 突破1周历史最高价');
      expect(message).toContain('当前价格: $55000.000000');
      expect(message).toContain('突破幅度: +10.00%');
    });

    test('should generate multi-breakthrough message correctly', () => {
      const result = {
        symbol: 'ETHUSDT',
        currentPrice: 3500,
        timeframeHigh: 3000,
        highTimestamp: Date.now(),
        isBreakthrough: true,
        breakAmount: 500,
        breakPercentage: 16.67
      };

      const message = service.generateBreakthroughMessage(result, '1m', true);

      expect(message).toContain('🚀🚀🚀 **市场突破警报** 🚀🚀🚀');
      expect(message).toContain('ETH 突破1个月历史高点');
      expect(message).toContain('突破幅度: +16.67%');
    });

    test('should update last check price correctly', () => {
      const alertConfig = {
        id: 'test-alert',
        symbol: 'BTC',
        type: AlertType.BREAKTHROUGH,
        condition: AlertCondition.BREAKS_TIMEFRAME_HIGH,
        thresholds: { value: 0 },
        enabled: true,
        notificationChannels: [],
        cooldownMs: 24 * 60 * 60 * 1000,
        maxRetries: 3,
        priority: AlertPriority.CRITICAL,
        metadata: { timeframe: '1w' }
      };

      const currentPrice = 55000;
      const updatedAlert = service.updateLastCheckPrice(alertConfig, currentPrice);

      expect(updatedAlert.metadata?.lastCheckPrice).toBe(currentPrice);
      expect(updatedAlert.metadata?.lastTriggeredTime).toBeDefined();
    });
  });

  describe('AlertConfig Generation', () => {
    test('should generate breakthrough alert config correctly', () => {
      const parsed = {
        symbol: 'BTC',
        condition: AlertCondition.BREAKS_TIMEFRAME_HIGH,
        value: 0,
        type: AlertType.BREAKTHROUGH,
        priority: AlertPriority.CRITICAL,
        timeframe: '1w',
        watchAllSymbols: false
      };

      const config = AlertCommandParser.toAlertConfig(parsed, 'user123', 12345);

      expect(config.symbol).toBe('BTC');
      expect(config.type).toBe(AlertType.BREAKTHROUGH);
      expect(config.cooldownMs).toBe(24 * 60 * 60 * 1000); // 24 hours
      expect(config.metadata?.timeframe).toBe('1w');
      expect(config.metadata?.watchAllSymbols).toBe(false);
      expect(config.metadata?.userId).toBe('user123');
      expect(config.metadata?.chatId).toBe(12345);
    });

    test('should generate multi-breakthrough alert config correctly', () => {
      const parsed = {
        symbol: 'ALL',
        condition: AlertCondition.BREAKS_HIGH,
        value: 0,
        type: AlertType.MULTI_BREAKTHROUGH,
        priority: AlertPriority.CRITICAL,
        timeframe: 'all',
        watchAllSymbols: true
      };

      const config = AlertCommandParser.toAlertConfig(parsed, 'user456', 67890);

      expect(config.symbol).toBe('ALL');
      expect(config.type).toBe(AlertType.MULTI_BREAKTHROUGH);
      expect(config.metadata?.watchAllSymbols).toBe(true);
      expect(config.metadata?.timeframe).toBe('all');
    });
  });

  describe('Alert Description Generation', () => {
    test('should generate breakthrough alert description', () => {
      const config = {
        id: 'test',
        symbol: 'BTC',
        type: AlertType.BREAKTHROUGH,
        condition: AlertCondition.BREAKS_TIMEFRAME_HIGH,
        thresholds: { value: 0, timeframe: '1w' },
        enabled: true,
        notificationChannels: [],
        cooldownMs: 24 * 60 * 60 * 1000,
        maxRetries: 3,
        priority: AlertPriority.CRITICAL
      };

      const description = AlertCommandParser.generateAlertDescription(config);
      expect(description).toBe('BTC 突破时间框架高点 (1周)');
    });

    test('should generate multi-breakthrough alert description', () => {
      const config = {
        id: 'test',
        symbol: 'ALL',
        type: AlertType.MULTI_BREAKTHROUGH,
        condition: AlertCondition.BREAKS_HIGH,
        thresholds: { value: 0, timeframe: 'all' },
        enabled: true,
        notificationChannels: [],
        cooldownMs: 24 * 60 * 60 * 1000,
        maxRetries: 3,
        priority: AlertPriority.CRITICAL
      };

      const description = AlertCommandParser.generateAlertDescription(config);
      expect(description).toBe('全币种 突破历史高点 (历史)');
    });
  });
});