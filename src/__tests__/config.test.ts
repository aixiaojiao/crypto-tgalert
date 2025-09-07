import { appConfig } from '../config';

describe('Configuration', () => {
  describe('appConfig', () => {
    it('should load required configuration values from environment', () => {
      expect(appConfig.telegram.botToken).toBe('test_bot_token');
      expect(appConfig.telegram.userId).toBe(12345);
      expect(appConfig.app.nodeEnv).toBe('test');
      expect(appConfig.database.path).toBe('./data/crypto-tgalert.db');
    });

    it('should have correct telegram configuration structure', () => {
      expect(appConfig.telegram).toHaveProperty('botToken');
      expect(appConfig.telegram).toHaveProperty('userId');
      expect(typeof appConfig.telegram.botToken).toBe('string');
      expect(typeof appConfig.telegram.userId).toBe('number');
      expect(appConfig.telegram.userId).toBeGreaterThan(0);
    });

    it('should have correct app configuration structure', () => {
      expect(appConfig.app).toHaveProperty('nodeEnv');
      expect(appConfig.app).toHaveProperty('logLevel');
      expect(appConfig.app).toHaveProperty('port');
      expect(['development', 'production', 'test']).toContain(appConfig.app.nodeEnv);
      expect(typeof appConfig.app.port).toBe('number');
      expect(appConfig.app.port).toBeGreaterThan(0);
      expect(appConfig.app.port).toBeLessThanOrEqual(65535);
    });

    it('should have database configuration', () => {
      expect(appConfig.database).toHaveProperty('path');
      expect(typeof appConfig.database.path).toBe('string');
      expect(appConfig.database.path.length).toBeGreaterThan(0);
    });

    it('should handle optional configurations correctly', () => {
      // These should be undefined or properly structured if present
      if (appConfig.binance) {
        expect(appConfig.binance).toHaveProperty('apiKey');
        expect(appConfig.binance).toHaveProperty('apiSecret');
        expect(typeof appConfig.binance.apiKey).toBe('string');
        expect(typeof appConfig.binance.apiSecret).toBe('string');
      }

      if (appConfig.twitter) {
        expect(appConfig.twitter).toHaveProperty('bearerToken');
        expect(typeof appConfig.twitter.bearerToken).toBe('string');
      }

      if (appConfig.blockchain) {
        expect(typeof appConfig.blockchain.etherscanApiKey).toBe('string');
        expect(typeof appConfig.blockchain.bscscanApiKey).toBe('string');
      }
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