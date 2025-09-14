import { initDatabase, closeDatabase } from '../../src/database/connection';
import { UserModel } from '../../src/models/User';
import { PriceAlertModel } from '../../src/models/PriceAlert';

describe('Database Tests', () => {
  beforeAll(async () => {
    process.env.DATABASE_PATH = ':memory:';
    await initDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('UserModel', () => {
    test('should create and find user', async () => {
      const userId = '123456789';
      const user = await UserModel.findOrCreateUser(userId);

      expect(user.user_id).toBe(userId);
      expect(user.created_at).toBeDefined();
      expect(user.updated_at).toBeDefined();
    });

    test('should return existing user on second call', async () => {
      const userId = '987654321';
      const user1 = await UserModel.findOrCreateUser(userId);
      const user2 = await UserModel.findOrCreateUser(userId);

      expect(user1.user_id).toBe(user2.user_id);
      expect(user1.created_at).toBe(user2.created_at);
    });

    test('should update user timestamp', async () => {
      const userId = '111222333';
      await UserModel.findOrCreateUser(userId);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      await UserModel.updateUser(userId);
      
      const updatedUser = await UserModel.findOrCreateUser(userId);
      expect(updatedUser.updated_at).toBeDefined();
    });
  });

  describe('PriceAlertModel', () => {
    beforeEach(async () => {
      await UserModel.findOrCreateUser('testuser');
    });

    test('should create price alert', async () => {
      const userId = 'testuser';
      const alertId = await PriceAlertModel.createAlert(
        userId, 'BTCUSDT', 'above', 50000
      );

      expect(alertId).toBeGreaterThan(0);

      const alerts = await PriceAlertModel.getActiveAlerts(userId);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].symbol).toBe('BTCUSDT');
      expect(alerts[0].condition).toBe('above');
      expect(alerts[0].value).toBe(50000);
      expect(alerts[0].is_active).toBe(1);
    });

    test('should get all active alerts', async () => {
      const userId = 'testuser2';
      await UserModel.findOrCreateUser(userId);
      
      await PriceAlertModel.createAlert(userId, 'ETHUSDT', 'below', 3000);
      await PriceAlertModel.createAlert(userId, 'ADAUSDT', 'change', 0.5);

      const allAlerts = await PriceAlertModel.getAllActiveAlerts();
      expect(allAlerts.length).toBeGreaterThanOrEqual(2);
    });

    test('should deactivate alert', async () => {
      const userId = 'testuser3';
      await UserModel.findOrCreateUser(userId);
      
      const alertId = await PriceAlertModel.createAlert(
        userId, 'DOGEUSDT', 'above', 0.1
      );

      await PriceAlertModel.deactivateAlert(alertId);

      const activeAlerts = await PriceAlertModel.getActiveAlerts(userId);
      expect(activeAlerts).toHaveLength(0);
    });
  });

});