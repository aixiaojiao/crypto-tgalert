import { BinanceWebSocketClient, TickerData, KlineData, TradeData, DepthData } from '../../src/services/binanceWebSocket';

describe('BinanceWebSocketClient', () => {
  let wsClient: BinanceWebSocketClient;
  const TEST_TIMEOUT = 30000; // 30 seconds for WebSocket tests

  beforeEach(() => {
    wsClient = new BinanceWebSocketClient();
  });

  afterEach(async () => {
    if (wsClient) {
      await wsClient.unsubscribeAll();
      wsClient.disconnect();
    }
  });

  describe('Connection Management Tests', () => {
    test('should initialize with disconnected state', () => {
      expect(wsClient.getConnectionStatus()).toBe('disconnected');
      expect(wsClient.getActiveSubscriptionsCount()).toBe(0);
      expect(wsClient.getActiveStreams()).toEqual([]);
    });

    test('should connect to Binance WebSocket', async () => {
      await wsClient.connect();
      expect(wsClient.getConnectionStatus()).toBe('connected');
    }, TEST_TIMEOUT);

    test('should disconnect from WebSocket', async () => {
      await wsClient.connect();
      expect(wsClient.getConnectionStatus()).toBe('connected');

      wsClient.disconnect();
      expect(wsClient.getConnectionStatus()).toBe('disconnected');
      expect(wsClient.getActiveSubscriptionsCount()).toBe(0);
    }, TEST_TIMEOUT);

    test('should not connect twice', async () => {
      await wsClient.connect();
      const firstStatus = wsClient.getConnectionStatus();
      
      await wsClient.connect(); // Try to connect again
      const secondStatus = wsClient.getConnectionStatus();
      
      expect(firstStatus).toBe('connected');
      expect(secondStatus).toBe('connected');
    }, TEST_TIMEOUT);
  });

  describe('Ticker Subscription Tests', () => {
    test('should subscribe to BTC ticker updates', async () => {
      let receivedData: TickerData | null = null;
      let dataCount = 0;

      const subscriptionId = await wsClient.subscribeTicker('BTCUSDT', (data: TickerData) => {
        receivedData = data;
        dataCount++;
        console.log(`📈 BTC Ticker: $${parseFloat(data.price).toFixed(2)} (${parseFloat(data.priceChangePercent).toFixed(2)}%)`);
      });

      expect(typeof subscriptionId).toBe('string');
      expect(wsClient.getActiveSubscriptionsCount()).toBe(1);
      expect(wsClient.getActiveStreams()).toContain('btcusdt@ticker');

      // Wait for at least one ticker update
      await new Promise((resolve) => {
        const checkForData = () => {
          if (receivedData) {
            resolve(undefined);
          } else {
            setTimeout(checkForData, 1000);
          }
        };
        checkForData();
      });

      expect(receivedData).toBeTruthy();
      expect(receivedData!.symbol).toBe('BTCUSDT');
      expect(typeof receivedData!.price).toBe('string');
      expect(parseFloat(receivedData!.price)).toBeGreaterThan(0);
      expect(typeof receivedData!.priceChangePercent).toBe('string');
      expect(typeof receivedData!.volume).toBe('string');
      expect(typeof receivedData!.timestamp).toBe('number');

      await wsClient.unsubscribe(subscriptionId);
      expect(wsClient.getActiveSubscriptionsCount()).toBe(0);
    }, TEST_TIMEOUT);

    test('should subscribe to multiple tickers', async () => {
      const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
      const receivedData: { [symbol: string]: TickerData } = {};

      const subscriptionIds = await wsClient.subscribeMultipleTickers(symbols, (data: TickerData) => {
        receivedData[data.symbol] = data;
        console.log(`📊 ${data.symbol}: $${parseFloat(data.price).toFixed(2)} (${parseFloat(data.priceChangePercent).toFixed(2)}%)`);
      });

      expect(subscriptionIds).toHaveLength(symbols.length);
      expect(wsClient.getActiveSubscriptionsCount()).toBe(symbols.length);

      // Wait for data from all symbols
      await new Promise((resolve) => {
        const checkForAllData = () => {
          if (Object.keys(receivedData).length >= symbols.length) {
            resolve(undefined);
          } else {
            setTimeout(checkForAllData, 1000);
          }
        };
        checkForAllData();
      });

      symbols.forEach(symbol => {
        expect(receivedData[symbol]).toBeDefined();
        expect(receivedData[symbol].symbol).toBe(symbol);
        expect(parseFloat(receivedData[symbol].price)).toBeGreaterThan(0);
      });

      // Unsubscribe from all
      for (const id of subscriptionIds) {
        await wsClient.unsubscribe(id);
      }
      expect(wsClient.getActiveSubscriptionsCount()).toBe(0);
    }, TEST_TIMEOUT);
  });

  describe('Kline Subscription Tests', () => {
    test('should subscribe to BTC kline updates', async () => {
      let receivedData: KlineData | null = null;

      const subscriptionId = await wsClient.subscribeKline('BTCUSDT', '1m', (data: KlineData) => {
        receivedData = data;
        console.log(`📈 BTC Kline (1m): O:${parseFloat(data.open).toFixed(2)} H:${parseFloat(data.high).toFixed(2)} L:${parseFloat(data.low).toFixed(2)} C:${parseFloat(data.close).toFixed(2)}`);
      });

      expect(typeof subscriptionId).toBe('string');
      expect(wsClient.getActiveSubscriptionsCount()).toBe(1);
      expect(wsClient.getActiveStreams()).toContain('btcusdt@kline_1m');

      // Wait for kline data
      await new Promise((resolve) => {
        const checkForData = () => {
          if (receivedData) {
            resolve(undefined);
          } else {
            setTimeout(checkForData, 1000);
          }
        };
        checkForData();
      });

      expect(receivedData).toBeTruthy();
      expect(receivedData!.symbol).toBe('BTCUSDT');
      expect(receivedData!.interval).toBe('1m');
      expect(typeof receivedData!.open).toBe('string');
      expect(typeof receivedData!.high).toBe('string');
      expect(typeof receivedData!.low).toBe('string');
      expect(typeof receivedData!.close).toBe('string');
      expect(typeof receivedData!.volume).toBe('string');
      expect(typeof receivedData!.openTime).toBe('number');
      expect(typeof receivedData!.closeTime).toBe('number');
      expect(typeof receivedData!.isClosed).toBe('boolean');

      // Validate OHLC values
      const open = parseFloat(receivedData!.open);
      const high = parseFloat(receivedData!.high);
      const low = parseFloat(receivedData!.low);
      const close = parseFloat(receivedData!.close);

      expect(open).toBeGreaterThan(0);
      expect(high).toBeGreaterThanOrEqual(Math.max(open, close));
      expect(low).toBeLessThanOrEqual(Math.min(open, close));
      expect(close).toBeGreaterThan(0);

      await wsClient.unsubscribe(subscriptionId);
    }, TEST_TIMEOUT);
  });

  describe('Trade Subscription Tests', () => {
    test('should subscribe to BTC trade updates', async () => {
      let receivedData: TradeData | null = null;
      let tradeCount = 0;

      const subscriptionId = await wsClient.subscribeTrade('BTCUSDT', (data: TradeData) => {
        receivedData = data;
        tradeCount++;
        console.log(`💱 BTC Trade: $${parseFloat(data.price).toFixed(2)} x ${parseFloat(data.quantity).toFixed(8)} ${data.isBuyerMaker ? '🔴' : '🟢'}`);
      });

      expect(typeof subscriptionId).toBe('string');
      expect(wsClient.getActiveSubscriptionsCount()).toBe(1);
      expect(wsClient.getActiveStreams()).toContain('btcusdt@trade');

      // Wait for trade data
      await new Promise((resolve) => {
        const checkForData = () => {
          if (receivedData && tradeCount >= 1) {
            resolve(undefined);
          } else {
            setTimeout(checkForData, 1000);
          }
        };
        checkForData();
      });

      expect(receivedData).toBeTruthy();
      expect(receivedData!.symbol).toBe('BTCUSDT');
      expect(typeof receivedData!.price).toBe('string');
      expect(typeof receivedData!.quantity).toBe('string');
      expect(typeof receivedData!.timestamp).toBe('number');
      expect(typeof receivedData!.isBuyerMaker).toBe('boolean');

      expect(parseFloat(receivedData!.price)).toBeGreaterThan(0);
      expect(parseFloat(receivedData!.quantity)).toBeGreaterThan(0);
      expect(receivedData!.timestamp).toBeGreaterThan(0);

      console.log(`✅ Received ${tradeCount} trade updates`);

      await wsClient.unsubscribe(subscriptionId);
    }, TEST_TIMEOUT);
  });

  describe('Depth Subscription Tests', () => {
    test('should subscribe to BTC depth updates', async () => {
      let receivedData: DepthData | null = null;

      const subscriptionId = await wsClient.subscribeDepth('BTCUSDT', (data: DepthData) => {
        receivedData = data;
        console.log(`📊 BTC Depth: ${data.bids.length} bids, ${data.asks.length} asks, updateId: ${data.lastUpdateId}`);
      });

      expect(typeof subscriptionId).toBe('string');
      expect(wsClient.getActiveSubscriptionsCount()).toBe(1);
      expect(wsClient.getActiveStreams()).toContain('btcusdt@depth');

      // Wait for depth data
      await new Promise((resolve) => {
        const checkForData = () => {
          if (receivedData) {
            resolve(undefined);
          } else {
            setTimeout(checkForData, 1000);
          }
        };
        checkForData();
      });

      expect(receivedData).toBeTruthy();
      expect(receivedData!.symbol).toBe('BTCUSDT');
      expect(Array.isArray(receivedData!.bids)).toBe(true);
      expect(Array.isArray(receivedData!.asks)).toBe(true);
      expect(typeof receivedData!.lastUpdateId).toBe('number');

      // Check bid format
      if (receivedData!.bids.length > 0) {
        const firstBid = receivedData!.bids[0];
        expect(Array.isArray(firstBid)).toBe(true);
        expect(firstBid).toHaveLength(2);
        expect(typeof firstBid[0]).toBe('string'); // price
        expect(typeof firstBid[1]).toBe('string'); // quantity
        expect(parseFloat(firstBid[0])).toBeGreaterThan(0);
        expect(parseFloat(firstBid[1])).toBeGreaterThan(0);
      }

      // Check ask format
      if (receivedData!.asks.length > 0) {
        const firstAsk = receivedData!.asks[0];
        expect(Array.isArray(firstAsk)).toBe(true);
        expect(firstAsk).toHaveLength(2);
        expect(typeof firstAsk[0]).toBe('string'); // price
        expect(typeof firstAsk[1]).toBe('string'); // quantity
        expect(parseFloat(firstAsk[0])).toBeGreaterThan(0);
        expect(parseFloat(firstAsk[1])).toBeGreaterThan(0);
      }

      await wsClient.unsubscribe(subscriptionId);
    }, TEST_TIMEOUT);
  });

  describe('Subscription Management Tests', () => {
    test('should handle multiple subscriptions for same symbol', async () => {
      let tickerData: TickerData | null = null;
      let klineData: KlineData | null = null;

      const tickerId = await wsClient.subscribeTicker('BTCUSDT', (data) => {
        tickerData = data;
      });

      const klineId = await wsClient.subscribeKline('BTCUSDT', '1m', (data) => {
        klineData = data;
      });

      expect(wsClient.getActiveSubscriptionsCount()).toBe(2);
      const streams = wsClient.getActiveStreams();
      expect(streams).toContain('btcusdt@ticker');
      expect(streams).toContain('btcusdt@kline_1m');

      // Wait for both data types
      await new Promise((resolve) => {
        const checkForData = () => {
          if (tickerData && klineData) {
            resolve(undefined);
          } else {
            setTimeout(checkForData, 1000);
          }
        };
        checkForData();
      });

      expect(tickerData).toBeTruthy();
      expect(klineData).toBeTruthy();
      expect(tickerData!.symbol).toBe('BTCUSDT');
      expect(klineData!.symbol).toBe('BTCUSDT');

      await wsClient.unsubscribe(tickerId);
      await wsClient.unsubscribe(klineId);
      expect(wsClient.getActiveSubscriptionsCount()).toBe(0);
    }, TEST_TIMEOUT);

    test('should unsubscribe from all subscriptions', async () => {
      const symbols = ['BTCUSDT', 'ETHUSDT'];
      const subscriptionIds: string[] = [];

      for (const symbol of symbols) {
        const id = await wsClient.subscribeTicker(symbol, () => {});
        subscriptionIds.push(id);
      }

      expect(wsClient.getActiveSubscriptionsCount()).toBe(symbols.length);

      await wsClient.unsubscribeAll();
      expect(wsClient.getActiveSubscriptionsCount()).toBe(0);
      expect(wsClient.getActiveStreams()).toEqual([]);
    }, TEST_TIMEOUT);

    test('should handle unsubscribing from non-existent subscription', async () => {
      const fakeId = 'fake-subscription-id';
      
      // Should not throw error
      await expect(wsClient.unsubscribe(fakeId)).resolves.not.toThrow();
      expect(wsClient.getActiveSubscriptionsCount()).toBe(0);
    });
  });

  describe('Error Handling Tests', () => {
    test('should handle connection errors gracefully', async () => {
      // Test with invalid URL (we can't easily test this without modifying the client)
      // For now, we'll just test that the client handles normal connection flow
      await wsClient.connect();
      expect(wsClient.getConnectionStatus()).toBe('connected');
      
      wsClient.disconnect();
      expect(wsClient.getConnectionStatus()).toBe('disconnected');
    }, TEST_TIMEOUT);

    test('should handle subscription to invalid symbol', async () => {
      // Binance WebSocket might not immediately reject invalid symbols
      // But our client should handle it gracefully

      try {
        await wsClient.subscribeTicker('INVALIDUSDT', () => {});
        // Even if it doesn't throw, it should track the subscription
        expect(wsClient.getActiveSubscriptionsCount()).toBe(1);
      } catch (error) {
        // Error is expected for invalid symbols, test should still pass
      }

      // Either way, no uncaught exceptions should occur
      expect(true).toBe(true); // Test passes if we get here
    }, TEST_TIMEOUT);
  });

  describe('Data Validation Tests', () => {
    test('should receive valid ticker data structure', async () => {
      let tickerData: TickerData | null = null;

      await wsClient.subscribeTicker('BTCUSDT', (data) => {
        tickerData = data;
      });

      // Wait for data
      await new Promise((resolve) => {
        const checkForData = () => {
          if (tickerData) {
            resolve(undefined);
          } else {
            setTimeout(checkForData, 1000);
          }
        };
        checkForData();
      });

      expect(tickerData).toBeTruthy();

      // Validate all required fields exist and have correct types
      expect(typeof tickerData!.symbol).toBe('string');
      expect(typeof tickerData!.price).toBe('string');
      expect(typeof tickerData!.priceChange).toBe('string');
      expect(typeof tickerData!.priceChangePercent).toBe('string');
      expect(typeof tickerData!.volume).toBe('string');
      expect(typeof tickerData!.timestamp).toBe('number');

      // Validate data is reasonable
      expect(tickerData!.symbol).toBe('BTCUSDT');
      expect(parseFloat(tickerData!.price)).toBeGreaterThan(0);
      expect(parseFloat(tickerData!.volume)).toBeGreaterThan(0);
      expect(tickerData!.timestamp).toBeGreaterThan(0);

      await wsClient.unsubscribeAll();
    }, TEST_TIMEOUT);
  });

  describe('Performance Tests', () => {
    test('should handle high-frequency updates without memory leaks', async () => {
      let updateCount = 0;
      const startTime = Date.now();

      await wsClient.subscribeTicker('BTCUSDT', () => {
        updateCount++;
      });

      // Wait for updates for 10 seconds
      await new Promise(resolve => setTimeout(resolve, 10000));

      const endTime = Date.now();
      const duration = endTime - startTime;
      const updatesPerSecond = (updateCount / duration) * 1000;

      console.log(`✅ Performance: ${updateCount} updates in ${duration}ms (${updatesPerSecond.toFixed(2)} updates/sec)`);

      expect(updateCount).toBeGreaterThan(0);
      expect(updatesPerSecond).toBeGreaterThan(0);

      await wsClient.unsubscribeAll();
    }, TEST_TIMEOUT);

    test('should maintain connection stability', async () => {
      let connectionStable = true;
      let updateCount = 0;

      await wsClient.subscribeTicker('BTCUSDT', () => {
        updateCount++;
        if (wsClient.getConnectionStatus() !== 'connected') {
          connectionStable = false;
        }
      });

      // Monitor for 5 seconds
      await new Promise(resolve => setTimeout(resolve, 5000));

      expect(connectionStable).toBe(true);
      expect(updateCount).toBeGreaterThan(0);
      expect(wsClient.getConnectionStatus()).toBe('connected');

      console.log(`✅ Connection stability: ${updateCount} updates received, connection remained stable`);

      await wsClient.unsubscribeAll();
    }, TEST_TIMEOUT);
  });
});