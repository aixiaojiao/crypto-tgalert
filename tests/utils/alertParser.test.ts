import { AlertCommandParser } from '../../src/utils/alertParser';
import {
  AlertType,
  AlertCondition,
  AlertPriority,
  NotificationChannel
} from '../../src/services/alerts/IAlertService';

describe('AlertCommandParser', () => {
  describe('Command Parsing', () => {
    it('should parse basic greater than command', () => {
      const args = ['BTC', '>', '50000'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.symbol).toBe('BTC');
      expect(result.condition).toBe(AlertCondition.GREATER_THAN);
      expect(result.value).toBe(50000);
      expect(result.type).toBe(AlertType.PRICE_ABOVE);
      expect(result.priority).toBe(AlertPriority.MEDIUM);
    });

    it('should parse basic less than command', () => {
      const args = ['ETH', '<', '3000'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.symbol).toBe('ETH');
      expect(result.condition).toBe(AlertCondition.LESS_THAN);
      expect(result.value).toBe(3000);
      expect(result.type).toBe(AlertType.PRICE_BELOW);
    });

    it('should parse equals command', () => {
      const args = ['DOGE', '=', '0.1'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.symbol).toBe('DOGE');
      expect(result.condition).toBe(AlertCondition.EQUALS);
      expect(result.value).toBe(0.1);
    });

    it('should parse percentage change command', () => {
      const args = ['BTC', 'change', '5%'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.symbol).toBe('BTC');
      expect(result.condition).toBe(AlertCondition.PERCENTAGE_CHANGE);
      expect(result.value).toBe(5);
      expect(result.type).toBe(AlertType.PRICE_CHANGE);
    });

    it('should parse crosses above command', () => {
      const args = ['ETH', 'crosses', 'above', '3500'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.symbol).toBe('ETH');
      expect(result.condition).toBe(AlertCondition.CROSSES_ABOVE);
      expect(result.value).toBe(3500);
      expect(result.type).toBe(AlertType.PRICE_ABOVE);
    });

    it('should parse crosses below command', () => {
      const args = ['BTC', 'crosses', 'below', '45000'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.symbol).toBe('BTC');
      expect(result.condition).toBe(AlertCondition.CROSSES_BELOW);
      expect(result.value).toBe(45000);
      expect(result.type).toBe(AlertType.PRICE_BELOW);
    });

    it('should handle case insensitive symbols', () => {
      const args = ['btc', '>', '50000'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.symbol).toBe('BTC');
    });

    it('should handle case insensitive conditions', () => {
      const args = ['BTC', 'ABOVE', '50000'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.condition).toBe(AlertCondition.GREATER_THAN);
    });

    it('should parse decimal values', () => {
      const args = ['ETH', '>', '3456.789'];
      const result = AlertCommandParser.parseAlertCommand(args);

      expect(result.value).toBe(3456.789);
    });

    it('should handle various condition formats', () => {
      const testCases = [
        { args: ['BTC', 'above', '50000'], expected: AlertCondition.GREATER_THAN },
        { args: ['BTC', 'over', '50000'], expected: AlertCondition.GREATER_THAN },
        { args: ['BTC', 'higher', '50000'], expected: AlertCondition.GREATER_THAN },
        { args: ['BTC', 'below', '50000'], expected: AlertCondition.LESS_THAN },
        { args: ['BTC', 'under', '50000'], expected: AlertCondition.LESS_THAN },
        { args: ['BTC', 'lower', '50000'], expected: AlertCondition.LESS_THAN },
        { args: ['BTC', 'equals', '50000'], expected: AlertCondition.EQUALS },
        { args: ['BTC', 'is', '50000'], expected: AlertCondition.EQUALS },
        { args: ['BTC', 'percent', '5'], expected: AlertCondition.PERCENTAGE_CHANGE },
        { args: ['BTC', 'pct', '5'], expected: AlertCondition.PERCENTAGE_CHANGE }
      ];

      testCases.forEach(({ args, expected }) => {
        const result = AlertCommandParser.parseAlertCommand(args);
        expect(result.condition).toBe(expected);
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw error for insufficient arguments', () => {
      expect(() => AlertCommandParser.parseAlertCommand(['BTC'])).toThrow('警报参数不足');
      expect(() => AlertCommandParser.parseAlertCommand(['BTC', '>'])).toThrow('警报参数不足');
      expect(() => AlertCommandParser.parseAlertCommand([])).toThrow('警报参数不足');
    });

    it('should throw error for invalid symbol', () => {
      expect(() => AlertCommandParser.parseAlertCommand(['B', '>', '50000'])).toThrow('无效的交易对符号');
      expect(() => AlertCommandParser.parseAlertCommand(['VERYLONGSYMBOL', '>', '50000'])).toThrow('无效的交易对符号');
      expect(() => AlertCommandParser.parseAlertCommand(['123', '>', '50000'])).toThrow('无效的交易对符号');
    });

    it('should throw error for unrecognized condition', () => {
      expect(() => AlertCommandParser.parseAlertCommand(['BTC', 'invalid', '50000'])).toThrow('无法识别的条件');
    });

    it('should throw error for missing value', () => {
      expect(() => AlertCommandParser.parseAlertCommand(['BTC', '>', 'abc'])).toThrow('无法找到有效的数值');
    });

    it('should throw error for invalid number', () => {
      expect(() => AlertCommandParser.parseAlertCommand(['BTC', '>', '0'])).toThrow('无效的数值');
    });
  });

  describe('AlertConfig Conversion', () => {
    it('should convert parsed command to AlertConfig', () => {
      const parsed = {
        symbol: 'BTC',
        condition: AlertCondition.GREATER_THAN,
        value: 50000,
        type: AlertType.PRICE_ABOVE,
        priority: AlertPriority.MEDIUM
      };

      const userId = 'test-user-123';
      const chatId = 987654321;

      const config = AlertCommandParser.toAlertConfig(parsed, userId, chatId);

      expect(config.symbol).toBe('BTC');
      expect(config.type).toBe(AlertType.PRICE_ABOVE);
      expect(config.condition).toBe(AlertCondition.GREATER_THAN);
      expect(config.thresholds.value).toBe(50000);
      expect(config.enabled).toBe(true);
      expect(config.notificationChannels).toEqual([NotificationChannel.TELEGRAM]);
      expect(config.cooldownMs).toBe(5 * 60 * 1000); // 5 minutes
      expect(config.maxRetries).toBe(3);
      expect(config.priority).toBe(AlertPriority.MEDIUM);
      expect(config.metadata?.userId).toBe(userId);
      expect(config.metadata?.chatId).toBe(chatId);
      expect(config.id).toMatch(/^test-user-123-BTC-\d+-\d+$/);
    });

    it('should generate unique IDs for different configs', () => {
      const parsed = {
        symbol: 'BTC',
        condition: AlertCondition.GREATER_THAN,
        value: 50000,
        type: AlertType.PRICE_ABOVE,
        priority: AlertPriority.MEDIUM
      };

      const config1 = AlertCommandParser.toAlertConfig(parsed, 'user1', 123);
      const config2 = AlertCommandParser.toAlertConfig(parsed, 'user1', 123);

      expect(config1.id).not.toBe(config2.id);
    });
  });

  describe('Alert Description Generation', () => {
    it('should generate description for price above alert', () => {
      const config = {
        id: 'test',
        symbol: 'BTC',
        type: AlertType.PRICE_ABOVE,
        condition: AlertCondition.GREATER_THAN,
        thresholds: { value: 50000 },
        enabled: true,
        notificationChannels: [NotificationChannel.TELEGRAM],
        cooldownMs: 300000,
        maxRetries: 3,
        priority: AlertPriority.MEDIUM
      };

      const description = AlertCommandParser.generateAlertDescription(config);
      expect(description).toBe('BTC 价格 高于 50000');
    });

    it('should generate description for price below alert', () => {
      const config = {
        id: 'test',
        symbol: 'ETH',
        type: AlertType.PRICE_BELOW,
        condition: AlertCondition.LESS_THAN,
        thresholds: { value: 3000 },
        enabled: true,
        notificationChannels: [NotificationChannel.TELEGRAM],
        cooldownMs: 300000,
        maxRetries: 3,
        priority: AlertPriority.MEDIUM
      };

      const description = AlertCommandParser.generateAlertDescription(config);
      expect(description).toBe('ETH 价格 低于 3000');
    });

    it('should generate description for price change alert', () => {
      const config = {
        id: 'test',
        symbol: 'DOGE',
        type: AlertType.PRICE_CHANGE,
        condition: AlertCondition.PERCENTAGE_CHANGE,
        thresholds: { value: 5 },
        enabled: true,
        notificationChannels: [NotificationChannel.TELEGRAM],
        cooldownMs: 300000,
        maxRetries: 3,
        priority: AlertPriority.MEDIUM
      };

      const description = AlertCommandParser.generateAlertDescription(config);
      expect(description).toBe('DOGE 价格变化 变化超过 5%');
    });

    it('should generate description for equals condition', () => {
      const config = {
        id: 'test',
        symbol: 'ADA',
        type: AlertType.PRICE_ABOVE,
        condition: AlertCondition.EQUALS,
        thresholds: { value: 1.5 },
        enabled: true,
        notificationChannels: [NotificationChannel.TELEGRAM],
        cooldownMs: 300000,
        maxRetries: 3,
        priority: AlertPriority.MEDIUM
      };

      const description = AlertCommandParser.generateAlertDescription(config);
      expect(description).toBe('ADA 价格 等于 1.5');
    });

    it('should generate description for crosses above condition', () => {
      const config = {
        id: 'test',
        symbol: 'SOL',
        type: AlertType.PRICE_ABOVE,
        condition: AlertCondition.CROSSES_ABOVE,
        thresholds: { value: 100 },
        enabled: true,
        notificationChannels: [NotificationChannel.TELEGRAM],
        cooldownMs: 300000,
        maxRetries: 3,
        priority: AlertPriority.MEDIUM
      };

      const description = AlertCommandParser.generateAlertDescription(config);
      expect(description).toBe('SOL 价格 突破上方 100');
    });

    it('should generate description for crosses below condition', () => {
      const config = {
        id: 'test',
        symbol: 'AVAX',
        type: AlertType.PRICE_BELOW,
        condition: AlertCondition.CROSSES_BELOW,
        thresholds: { value: 20 },
        enabled: true,
        notificationChannels: [NotificationChannel.TELEGRAM],
        cooldownMs: 300000,
        maxRetries: 3,
        priority: AlertPriority.MEDIUM
      };

      const description = AlertCommandParser.generateAlertDescription(config);
      expect(description).toBe('AVAX 价格 跌破下方 20');
    });
  });

  describe('Integration Tests', () => {
    it('should parse complex command and generate correct config', () => {
      const args = ['MATIC', 'crosses', 'above', '1.25'];
      const parsed = AlertCommandParser.parseAlertCommand(args);
      const config = AlertCommandParser.toAlertConfig(parsed, 'trader-456', 111222333);

      expect(config.symbol).toBe('MATIC');
      expect(config.type).toBe(AlertType.PRICE_ABOVE);
      expect(config.condition).toBe(AlertCondition.CROSSES_ABOVE);
      expect(config.thresholds.value).toBe(1.25);
      expect(config.metadata?.userId).toBe('trader-456');
      expect(config.metadata?.chatId).toBe(111222333);

      const description = AlertCommandParser.generateAlertDescription(config);
      expect(description).toBe('MATIC 价格 突破上方 1.25');
    });

    it('should handle end-to-end workflow for percentage change alert', () => {
      const args = ['BTC', '%', '3.5'];
      const parsed = AlertCommandParser.parseAlertCommand(args);
      const config = AlertCommandParser.toAlertConfig(parsed, 'analyst-789', 444555666);

      expect(config.type).toBe(AlertType.PRICE_CHANGE);
      expect(config.condition).toBe(AlertCondition.PERCENTAGE_CHANGE);
      expect(config.thresholds.value).toBe(3.5);

      const description = AlertCommandParser.generateAlertDescription(config);
      expect(description).toBe('BTC 价格变化 变化超过 3.5%');
    });

    it('should handle various symbol formats', () => {
      const testSymbols = ['BTC', 'btc', 'Btc', 'ETH', 'USDT', 'BNB', 'ADA', 'DOT', 'LINK', 'MATIC'];

      testSymbols.forEach(symbol => {
        const args = [symbol, '>', '1000'];
        const result = AlertCommandParser.parseAlertCommand(args);
        expect(result.symbol).toBe(symbol.toUpperCase());
      });
    });

    it('should maintain consistency between parsing and description generation', () => {
      const testCases = [
        { args: ['BTC', '>', '50000'], expectedDesc: 'BTC 价格 高于 50000' },
        { args: ['ETH', '<', '3000'], expectedDesc: 'ETH 价格 低于 3000' },
        { args: ['DOGE', 'change', '10'], expectedDesc: 'DOGE 价格变化 变化超过 10%' },
        { args: ['ADA', 'crosses', 'above', '2'], expectedDesc: 'ADA 价格 突破上方 2' }
      ];

      testCases.forEach(({ args, expectedDesc }) => {
        const parsed = AlertCommandParser.parseAlertCommand(args);
        const config = AlertCommandParser.toAlertConfig(parsed, 'test-user', 123456);
        const description = AlertCommandParser.generateAlertDescription(config);
        expect(description).toBe(expectedDesc);
      });
    });
  });
});