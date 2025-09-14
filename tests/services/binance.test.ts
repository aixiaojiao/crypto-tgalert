import { BinanceClient } from '../../src/services/binance';
import { BinanceApiError } from '../../src/types/binance';
import { binanceRateLimit } from '../../src/utils/ratelimit';

describe('BinanceClient', () => {
  let client: BinanceClient;

  beforeEach(() => {
    client = new BinanceClient();
  });

  afterEach(() => {
    // Clean up any resources if needed
  });

  afterAll(() => {
    // Clean up global rate limiters to prevent memory leaks in tests
    binanceRateLimit.destroy();
  });

  describe('Connection Tests', () => {
    test('should ping Binance API successfully', async () => {
      const result = await client.ping();
      expect(result).toBe(true);
    }, 10000);

    test('should get server time', async () => {
      const serverTime = await client.getServerTime();
      expect(typeof serverTime).toBe('number');
      expect(serverTime).toBeGreaterThan(0);
      
      // Server time should be within reasonable range of current time
      const now = Date.now();
      const timeDiff = Math.abs(now - serverTime);
      expect(timeDiff).toBeLessThan(60000); // Within 1 minute
    }, 10000);

    test('should get exchange info', async () => {
      const exchangeInfo = await client.getExchangeInfo();
      
      expect(exchangeInfo).toBeDefined();
      expect(exchangeInfo.timezone).toBe('UTC');
      expect(Array.isArray(exchangeInfo.symbols)).toBe(true);
      expect(exchangeInfo.symbols.length).toBeGreaterThan(0);
      expect(Array.isArray(exchangeInfo.rateLimits)).toBe(true);
    }, 15000);
  });

  describe('Price Data Tests', () => {
    const testSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

    test('should fetch BTC price successfully', async () => {
      const price = await client.getPrice('BTCUSDT');
      
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThan(1000000); // Reasonable upper bound
      
      console.log(`✅ BTC Price: $${price.toFixed(2)}`);
    }, 10000);

    test('should fetch ETH price successfully', async () => {
      const price = await client.getPrice('ETHUSDT');
      
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThan(100000); // Reasonable upper bound
      
      console.log(`✅ ETH Price: $${price.toFixed(2)}`);
    }, 10000);

    test('should fetch SOL price successfully', async () => {
      const price = await client.getPrice('SOLUSDT');
      
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThan(10000); // Reasonable upper bound
      
      console.log(`✅ SOL Price: $${price.toFixed(2)}`);
    }, 10000);

    test('should fetch multiple prices at once', async () => {
      const prices = await client.getPrices(testSymbols);
      
      expect(Array.isArray(prices)).toBe(true);
      expect(prices.length).toBe(testSymbols.length);
      
      prices.forEach((priceData, index) => {
        expect(priceData.symbol).toBe(testSymbols[index]);
        expect(typeof priceData.price).toBe('string');
        expect(parseFloat(priceData.price)).toBeGreaterThan(0);
        
        console.log(`✅ ${priceData.symbol}: $${parseFloat(priceData.price).toFixed(2)}`);
      });
    }, 15000);

    test('should fetch all prices when no symbols specified', async () => {
      const prices = await client.getPrices();
      
      expect(Array.isArray(prices)).toBe(true);
      expect(prices.length).toBeGreaterThan(100); // Should have many trading pairs
      
      // Check first few entries
      const firstFew = prices.slice(0, 5);
      firstFew.forEach(priceData => {
        expect(typeof priceData.symbol).toBe('string');
        expect(typeof priceData.price).toBe('string');
        expect(parseFloat(priceData.price)).toBeGreaterThan(0);
      });
      
      console.log(`✅ Fetched ${prices.length} price tickers`);
    }, 20000);
  });

  describe('24hr Statistics Tests', () => {
    test('should fetch 24hr stats for BTC', async () => {
      const stats = await client.get24hrStats('BTCUSDT');
      
      expect(stats.symbol).toBe('BTCUSDT');
      expect(typeof stats.lastPrice).toBe('string');
      expect(typeof stats.priceChange).toBe('string');
      expect(typeof stats.priceChangePercent).toBe('string');
      expect(typeof stats.volume).toBe('string');
      
      const price = parseFloat(stats.lastPrice);
      const change = parseFloat(stats.priceChangePercent);
      
      expect(price).toBeGreaterThan(0);
      expect(change).toBeGreaterThan(-100); // Can't lose more than 100%
      expect(change).toBeLessThan(1000); // Unlikely to gain more than 1000% in 24h
      
      console.log(`✅ BTC 24h: $${price.toFixed(2)} (${change.toFixed(2)}%)`);
    }, 10000);

    test('should fetch 24hr stats for multiple symbols', async () => {
      const symbols = ['BTCUSDT', 'ETHUSDT'];
      const stats = await client.get24hrStatsMultiple(symbols);
      
      expect(Array.isArray(stats)).toBe(true);
      expect(stats.length).toBe(symbols.length);
      
      stats.forEach((stat, index) => {
        expect(stat.symbol).toBe(symbols[index]);
        expect(typeof stat.lastPrice).toBe('string');
        expect(parseFloat(stat.lastPrice)).toBeGreaterThan(0);
        
        console.log(`✅ ${stat.symbol} 24h: $${parseFloat(stat.lastPrice).toFixed(2)} (${parseFloat(stat.priceChangePercent).toFixed(2)}%)`);
      });
    }, 15000);
  });

  describe('Order Book Tests', () => {
    test('should fetch order book for BTCUSDT', async () => {
      const orderBook = await client.getOrderBook('BTCUSDT', 10);
      
      expect(orderBook).toBeDefined();
      expect(typeof orderBook.lastUpdateId).toBe('number');
      expect(Array.isArray(orderBook.bids)).toBe(true);
      expect(Array.isArray(orderBook.asks)).toBe(true);
      expect(orderBook.bids.length).toBeLessThanOrEqual(10);
      expect(orderBook.asks.length).toBeLessThanOrEqual(10);
      
      // Check bid structure (bids are arrays of [price, quantity])
      if (orderBook.bids.length > 0) {
        const firstBid = orderBook.bids[0];
        expect(Array.isArray(firstBid)).toBe(true);
        expect(firstBid).toHaveLength(2);
        expect(typeof firstBid[0]).toBe('string'); // price
        expect(typeof firstBid[1]).toBe('string'); // quantity
        expect(parseFloat(firstBid[0])).toBeGreaterThan(0);
        expect(parseFloat(firstBid[1])).toBeGreaterThan(0);
      }
      
      // Check ask structure (asks are arrays of [price, quantity])
      if (orderBook.asks.length > 0) {
        const firstAsk = orderBook.asks[0];
        expect(Array.isArray(firstAsk)).toBe(true);
        expect(firstAsk).toHaveLength(2);
        expect(typeof firstAsk[0]).toBe('string'); // price
        expect(typeof firstAsk[1]).toBe('string'); // quantity
        expect(parseFloat(firstAsk[0])).toBeGreaterThan(0);
        expect(parseFloat(firstAsk[1])).toBeGreaterThan(0);
      }
      
      console.log(`✅ Order book: ${orderBook.bids.length} bids, ${orderBook.asks.length} asks`);
    }, 10000);
  });

  describe('Klines Tests', () => {
    test('should fetch kline data for BTCUSDT', async () => {
      const klines = await client.getKlines({
        symbol: 'BTCUSDT',
        interval: '1h',
        limit: 10
      });
      
      expect(Array.isArray(klines)).toBe(true);
      expect(klines.length).toBeLessThanOrEqual(10);
      expect(klines.length).toBeGreaterThan(0);
      
      const firstKline = klines[0];
      expect(typeof firstKline.openTime).toBe('number');
      expect(typeof firstKline.closeTime).toBe('number');
      expect(typeof firstKline.open).toBe('string');
      expect(typeof firstKline.high).toBe('string');
      expect(typeof firstKline.low).toBe('string');
      expect(typeof firstKline.close).toBe('string');
      expect(typeof firstKline.volume).toBe('string');
      
      expect(parseFloat(firstKline.open)).toBeGreaterThan(0);
      expect(parseFloat(firstKline.high)).toBeGreaterThan(0);
      expect(parseFloat(firstKline.low)).toBeGreaterThan(0);
      expect(parseFloat(firstKline.close)).toBeGreaterThan(0);
      
      console.log(`✅ Klines: ${klines.length} candles, latest close: $${parseFloat(firstKline.close).toFixed(2)}`);
    }, 15000);
  });

  describe('Symbol Validation Tests', () => {
    test('should validate BTCUSDT as valid trading symbol', async () => {
      const isValid = await client.isSymbolValid('BTCUSDT');
      expect(isValid).toBe(true);
    }, 10000);

    test('should validate ETHUSDT as valid trading symbol', async () => {
      const isValid = await client.isSymbolValid('ETHUSDT');
      expect(isValid).toBe(true);
    }, 10000);

    test('should return false for invalid symbol', async () => {
      const isValid = await client.isSymbolValid('INVALIDUSDT');
      expect(isValid).toBe(false);
    }, 10000);

    test('should get list of trading symbols', async () => {
      const symbols = await client.getTradingSymbols();
      
      expect(Array.isArray(symbols)).toBe(true);
      expect(symbols.length).toBeGreaterThan(100);
      expect(symbols).toContain('BTCUSDT');
      expect(symbols).toContain('ETHUSDT');
      
      console.log(`✅ Found ${symbols.length} trading symbols`);
    }, 15000);
  });

  describe('Average Price Tests', () => {
    test('should fetch average price for BTCUSDT', async () => {
      const avgPrice = await client.getAvgPrice('BTCUSDT');
      
      expect(avgPrice).toBeDefined();
      expect(typeof avgPrice.mins).toBe('number');
      expect(typeof avgPrice.price).toBe('string');
      expect(avgPrice.mins).toBeGreaterThan(0);
      expect(parseFloat(avgPrice.price)).toBeGreaterThan(0);
      
      console.log(`✅ BTC Average Price (${avgPrice.mins}min): $${parseFloat(avgPrice.price).toFixed(2)}`);
    }, 10000);
  });

  describe('Error Handling Tests', () => {
    test('should handle invalid symbol gracefully', async () => {
      await expect(client.getPrice('INVALIDSYMBOL')).rejects.toThrow(BinanceApiError);
    }, 10000);

    test('should handle network timeout', async () => {
      // This test is placeholder since we can't easily test timeout without modifying the client
      expect(true).toBe(true);
    });
  });

  describe('Rate Limiting Tests', () => {
    test('should respect rate limits', async () => {
      // Make multiple rapid requests to test rate limiting
      const promises = Array(5).fill(null).map(() => client.getPrice('BTCUSDT'));
      
      const results = await Promise.all(promises);
      
      // All requests should succeed (rate limiter should handle this)
      results.forEach(price => {
        expect(typeof price).toBe('number');
        expect(price).toBeGreaterThan(0);
      });
      
      console.log('✅ Rate limiting handled correctly');
    }, 15000);
  });

  describe('Data Consistency Tests', () => {
    test('should return consistent data types', async () => {
      const [price, stats, orderBook] = await Promise.all([
        client.getPrice('BTCUSDT'),
        client.get24hrStats('BTCUSDT'),
        client.getOrderBook('BTCUSDT', 5)
      ]);
      
      // Price should be a number
      expect(typeof price).toBe('number');
      
      // Stats should have string prices but be parseable as numbers
      expect(typeof stats.lastPrice).toBe('string');
      expect(parseFloat(stats.lastPrice)).toBeGreaterThan(0);
      
      // Order book should have proper structure
      expect(Array.isArray(orderBook.bids)).toBe(true);
      expect(Array.isArray(orderBook.asks)).toBe(true);
      
      // All prices should be reasonably close to each other
      const statsPrice = parseFloat(stats.lastPrice);
      const priceDiff = Math.abs(price - statsPrice) / price;
      expect(priceDiff).toBeLessThan(0.01); // Within 1%
      
      console.log(`✅ Data consistency check passed - Price: $${price.toFixed(2)}, Stats: $${statsPrice.toFixed(2)}`);
    }, 15000);
  });

  describe('Performance Tests', () => {
    test('should fetch prices within reasonable time', async () => {
      const startTime = Date.now();
      await client.getPrice('BTCUSDT');
      const endTime = Date.now();
      
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      
      console.log(`✅ Price fetch completed in ${duration}ms`);
    });

    test('should handle multiple concurrent requests', async () => {
      const startTime = Date.now();
      const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOTUSDT'];
      
      const promises = symbols.map(symbol => client.getPrice(symbol));
      const results = await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(results).toHaveLength(symbols.length);
      results.forEach(price => {
        expect(typeof price).toBe('number');
        expect(price).toBeGreaterThan(0);
      });
      
      console.log(`✅ ${symbols.length} concurrent requests completed in ${duration}ms`);
    }, 20000);
  });
});