import { config } from '../config';

describe('Configuration', () => {
  describe('config', () => {
    it('should load required configuration values from environment', () => {
      expect(config.telegram.botToken).toBeDefined();
      expect(config.telegram.userId).toBeDefined();
      expect(config.app.nodeEnv).toBeDefined();
      expect(config.app.databasePath).toBeDefined();
    });

    it('should have correct telegram configuration structure', () => {
      expect(config.telegram).toHaveProperty('botToken');
      expect(config.telegram).toHaveProperty('userId');
      expect(typeof config.telegram.botToken).toBe('string');
      expect(typeof config.telegram.userId).toBe('string');
    });

    it('should have correct app configuration structure', () => {
      expect(config.app).toHaveProperty('nodeEnv');
      expect(config.app).toHaveProperty('logLevel');
      expect(config.app).toHaveProperty('port');
      expect(['development', 'production', 'test']).toContain(config.app.nodeEnv);
      expect(typeof config.app.port).toBe('number');
      expect(config.app.port).toBeGreaterThan(0);
      expect(config.app.port).toBeLessThanOrEqual(65535);
    });

    it('should have database configuration', () => {
      expect(config.app).toHaveProperty('databasePath');
      expect(typeof config.app.databasePath).toBe('string');
      expect(config.app.databasePath.length).toBeGreaterThan(0);
    });

    it('should handle binance configuration correctly', () => {
      expect(config.binance).toHaveProperty('apiKey');
      expect(config.binance).toHaveProperty('apiSecret');
      expect(typeof config.binance.apiKey).toBe('string');
      expect(typeof config.binance.apiSecret).toBe('string');
    });
  });

  describe('Environment validation', () => {
    it('should validate required environment variables on import', () => {
      // This test verifies that the config loads without throwing
      // The actual validation happens during module import
      expect(() => {
        // Re-import to test validation
        delete require.cache[require.resolve('../config')];
        require('../config');
      }).not.toThrow();
    });
  });
});