import { log } from '../../src/utils/logger';
import { ValidationError, retry } from '../../src/utils/errors';
import { RateLimiter, binanceRateLimit } from '../../src/utils/ratelimit';
import { validateTradingPair, validatePrice } from '../../src/utils/validation';

describe('Infrastructure Tests', () => {
  afterAll(() => {
    // Clean up global rate limiters to prevent memory leaks in tests
    binanceRateLimit.destroy();
  });

  test('logger should work', () => {
    expect(() => {
      log.info('Test message');
      log.error('Test error');
    }).not.toThrow();
  });

  test('custom errors should work', () => {
    const error = new ValidationError('Test validation error');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('ValidationError');
  });

  test('rate limiter should work', () => {
    const limiter = new RateLimiter({
      windowMs: 1000,
      maxRequests: 2
    });

    expect(limiter.isLimited('test')).toBe(false);
    expect(limiter.isLimited('test')).toBe(false);
    expect(limiter.isLimited('test')).toBe(true);

    // Clean up the interval to prevent memory leak
    limiter.destroy();
  });

  test('validation should work', () => {
    expect(validateTradingPair('BTCUSDT')).toBe(true);
    expect(validateTradingPair('invalid')).toBe(false);
    expect(validatePrice(100)).toBe(true);
    expect(validatePrice(-1)).toBe(false);
  });

  test('retry mechanism should work', async () => {
    let attempts = 0;
    const failTwice = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Test error');
      }
      return 'success';
    };

    const result = await retry(failTwice, 3, 100);
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });
});