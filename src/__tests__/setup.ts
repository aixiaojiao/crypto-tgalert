import * as dotenv from 'dotenv';

// Load environment variables for testing
dotenv.config();

// Set test timeout
jest.setTimeout(30000);

// Mock console methods to reduce noise during testing
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Global test utilities
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidTimestamp(): R;
      toBeValidPrice(): R;
      toBeValidSymbol(): R;
    }
  }
}

// Custom matchers
expect.extend({
  toBeValidTimestamp(received: any) {
    const isValid = 
      typeof received === 'number' && 
      received > 0 && 
      received <= Date.now() + 1000 && // Allow 1s future tolerance
      received >= 1000000000000; // After year 2001

    return {
      message: () => `expected ${received} to be a valid timestamp`,
      pass: isValid,
    };
  },

  toBeValidPrice(received: any) {
    const isValid = 
      typeof received === 'string' && 
      /^\d+(\.\d+)?$/.test(received) &&
      parseFloat(received) > 0;

    return {
      message: () => `expected ${received} to be a valid price string`,
      pass: isValid,
    };
  },

  toBeValidSymbol(received: any) {
    const isValid = 
      typeof received === 'string' && 
      /^[A-Z]{3,}$/.test(received) &&
      received.length >= 6; // Minimum symbol length like BTCUSDT

    return {
      message: () => `expected ${received} to be a valid trading symbol`,
      pass: isValid,
    };
  },
});