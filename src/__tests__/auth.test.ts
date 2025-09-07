import { authMiddleware, isAuthorizedUser, requireAuth } from '../middleware/auth';
import { BotContext } from '../types';

// Mock the config module
jest.mock('../config', () => ({
  appConfig: {
    telegram: {
      userId: 12345
    }
  }
}));

describe('Authentication Middleware', () => {
  let mockContext: Partial<BotContext>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockContext = {
      from: { id: 12345 },
      reply: jest.fn(),
      isAuthorized: false
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('authMiddleware', () => {
    it('should authorize valid user and call next', async () => {
      await authMiddleware(mockContext as BotContext, mockNext);

      expect(mockContext.isAuthorized).toBe(true);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockContext.reply).not.toHaveBeenCalled();
    });

    it('should reject user with invalid ID', async () => {
      mockContext.from = { id: 54321 }; // Different user ID

      await authMiddleware(mockContext as BotContext, mockNext);

      expect(mockContext.isAuthorized).toBe(false);
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.reply).toHaveBeenCalledWith('🚫 Access denied. This bot is for authorized users only.');
    });

    it('should reject request without user ID', async () => {
      mockContext.from = undefined;

      await authMiddleware(mockContext as BotContext, mockNext);

      expect(mockContext.isAuthorized).toBe(false);
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.reply).toHaveBeenCalledWith('❌ Authentication failed: Invalid user.');
    });

    it('should handle missing from property gracefully', async () => {
      delete mockContext.from;

      await authMiddleware(mockContext as BotContext, mockNext);

      expect(mockContext.isAuthorized).toBe(false);
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.reply).toHaveBeenCalledWith('❌ Authentication failed: Invalid user.');
    });
  });

  describe('isAuthorizedUser', () => {
    it('should return true for authorized user', () => {
      mockContext.isAuthorized = true;
      
      const result = isAuthorizedUser(mockContext as BotContext);
      
      expect(result).toBe(true);
    });

    it('should return false for unauthorized user', () => {
      mockContext.isAuthorized = false;
      
      const result = isAuthorizedUser(mockContext as BotContext);
      
      expect(result).toBe(false);
    });

    it('should return false for undefined authorization', () => {
      delete mockContext.isAuthorized;
      
      const result = isAuthorizedUser(mockContext as BotContext);
      
      expect(result).toBe(false);
    });
  });

  describe('requireAuth', () => {
    it('should call next for authorized user', async () => {
      mockContext.isAuthorized = true;

      await requireAuth(mockContext as BotContext, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockContext.reply).not.toHaveBeenCalled();
    });

    it('should reject unauthorized user', async () => {
      mockContext.isAuthorized = false;

      await requireAuth(mockContext as BotContext, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.reply).toHaveBeenCalledWith('🔒 This command requires authorization.');
    });

    it('should reject user with undefined authorization', async () => {
      delete mockContext.isAuthorized;

      await requireAuth(mockContext as BotContext, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockContext.reply).toHaveBeenCalledWith('🔒 This command requires authorization.');
    });
  });
});