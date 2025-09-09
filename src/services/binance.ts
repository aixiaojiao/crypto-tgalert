import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { createHmac } from 'crypto';
import { config } from '../config';
import { log } from '../utils/logger';
import { binanceRateLimit } from '../utils/ratelimit';
import { oiCache, marketDataCache, CacheManager } from '../utils/cache';
import {
  SymbolPriceTicker,
  Ticker24hr,
  BinanceApiError,
  BinanceErrorCode,
  OrderBookParams,
  OrderBook,
  KlinesParams,
  Kline,
  ExchangeInfo,
  FuturesExchangeInfo,
  FuturesTicker24hr,
  FundingRate,
  OpenInterest,
  OpenInterestStats
} from '../types/binance';

export interface BinancePriceResponse {
  symbol: string;
  price: string;
}

export interface Binance24hrResponse {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  lastPrice: string;
  volume: string;
  highPrice: string;
  lowPrice: string;
}

export class BinanceClient {
  private client: AxiosInstance;
  private futuresClient: AxiosInstance;
  private baseURL = 'https://api.binance.com';
  private futuresBaseURL = 'https://fapi.binance.com';
  private apiKey: string;
  private apiSecret: string;

  constructor() {
    this.apiKey = config.binance.apiKey;
    this.apiSecret = config.binance.apiSecret;

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'crypto-tgalert/1.0.0'
      }
    });

    this.futuresClient = axios.create({
      baseURL: this.futuresBaseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'crypto-tgalert/1.0.0'
      }
    });

    this.setupInterceptors();
    this.setupFuturesInterceptors();
    log.info('BinanceClient initialized', { baseURL: this.baseURL, futuresBaseURL: this.futuresBaseURL });
  }

  private setupInterceptors(): void {
    // Request interceptor for rate limiting and authentication
    this.client.interceptors.request.use(
      async (config) => {
        // Check rate limiting
        if (binanceRateLimit.isLimited('binance-api')) {
          const remaining = binanceRateLimit.getRemainingRequests('binance-api');
          const error = new BinanceApiError(
            `Rate limit exceeded. Remaining requests: ${remaining}`,
            BinanceErrorCode.TOO_MANY_REQUESTS
          );
          throw error;
        }

        // Add API key to headers for authenticated endpoints
        if (this.requiresAuthentication(config.url || '')) {
          config.headers = config.headers || {};
          config.headers['X-MBX-APIKEY'] = this.apiKey;

          // Add signature for signed endpoints
          if (this.requiresSignature(config.url || '')) {
            const timestamp = Date.now();
            const query = this.buildQueryString({
              ...config.params,
              timestamp
            });

            const signature = this.createSignature(query);
            config.params = {
              ...config.params,
              timestamp,
              signature
            };
          }
        }

        log.debug('Binance API request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          params: config.params
        });

        return config;
      },
      (error) => {
        log.error('Request interceptor error', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        log.debug('Binance API response', {
          status: response.status,
          url: response.config.url,
          dataLength: JSON.stringify(response.data).length
        });
        return response;
      },
      (error) => {
        log.error('Binance API error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: error.config?.url
        });

        if (error.response?.data) {
          const { code, msg } = error.response.data;
          throw new BinanceApiError(msg || 'Binance API Error', code || BinanceErrorCode.UNKNOWN);
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          throw new BinanceApiError('Network connection failed', BinanceErrorCode.DISCONNECTED);
        }

        if (error.code === 'ETIMEDOUT') {
          throw new BinanceApiError('Request timeout', BinanceErrorCode.TIMEOUT);
        }

        throw new BinanceApiError(error.message || 'Unknown error', BinanceErrorCode.UNKNOWN);
      }
    );
  }

  private setupFuturesInterceptors(): void {
    // Request interceptor for futures API
    this.futuresClient.interceptors.request.use(
      async (config) => {
        // Check rate limiting
        if (binanceRateLimit.isLimited('binance-futures')) {
          const remaining = binanceRateLimit.getRemainingRequests('binance-futures');
          const error = new BinanceApiError(
            `Rate limit exceeded. Remaining requests: ${remaining}`,
            BinanceErrorCode.TOO_MANY_REQUESTS
          );
          throw error;
        }

        // Add API key to headers for authenticated endpoints
        if (this.requiresFuturesAuthentication(config.url || '')) {
          config.headers = config.headers || {};
          config.headers['X-MBX-APIKEY'] = this.apiKey;

          // Add signature for signed endpoints
          if (this.requiresFuturesSignature(config.url || '')) {
            const timestamp = Date.now();
            const query = this.buildQueryString({
              ...config.params,
              timestamp
            });

            const signature = this.createSignature(query);
            config.params = {
              ...config.params,
              timestamp,
              signature
            };
          }
        }

        log.debug('Binance Futures API request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          params: config.params
        });

        return config;
      },
      (error) => {
        log.error('Futures request interceptor error', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for futures API
    this.futuresClient.interceptors.response.use(
      (response: AxiosResponse) => {
        log.debug('Binance Futures API response', {
          status: response.status,
          url: response.config.url,
          dataLength: JSON.stringify(response.data).length
        });
        return response;
      },
      (error) => {
        log.error('Binance Futures API error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: error.config?.url
        });

        if (error.response?.data) {
          const { code, msg } = error.response.data;
          throw new BinanceApiError(msg || 'Binance Futures API Error', code || BinanceErrorCode.UNKNOWN);
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          throw new BinanceApiError('Network connection failed', BinanceErrorCode.DISCONNECTED);
        }

        if (error.code === 'ETIMEDOUT') {
          throw new BinanceApiError('Request timeout', BinanceErrorCode.TIMEOUT);
        }

        throw new BinanceApiError(error.message || 'Unknown error', BinanceErrorCode.UNKNOWN);
      }
    );
  }

  private requiresAuthentication(url: string): boolean {
    // Most endpoints require API key, except for market data
    const publicEndpoints = ['/api/v3/ping', '/api/v3/time', '/api/v3/exchangeInfo', 
                           '/api/v3/ticker/price', '/api/v3/ticker/24hr', '/api/v3/depth',
                           '/api/v3/klines', '/api/v3/avgPrice'];
    return !publicEndpoints.some(endpoint => url.includes(endpoint));
  }

  private requiresSignature(url: string): boolean {
    // Only account endpoints require signature
    const signedEndpoints = ['/api/v3/account', '/api/v3/order', '/api/v3/allOrders',
                           '/api/v3/openOrders', '/api/v3/myTrades'];
    return signedEndpoints.some(endpoint => url.includes(endpoint));
  }

  private requiresFuturesAuthentication(url: string): boolean {
    // Most futures endpoints require API key, except for market data
    const publicEndpoints = ['/fapi/v1/ping', '/fapi/v1/time', '/fapi/v1/exchangeInfo', 
                           '/fapi/v1/ticker/price', '/fapi/v1/ticker/24hr', '/fapi/v1/depth',
                           '/fapi/v1/klines', '/fapi/v1/fundingRate', '/fapi/v1/openInterest',
                           '/fapi/v1/ticker/bookTicker'];
    return !publicEndpoints.some(endpoint => url.includes(endpoint));
  }

  private requiresFuturesSignature(url: string): boolean {
    // Only account endpoints require signature in futures
    const signedEndpoints = ['/fapi/v2/account', '/fapi/v1/order', '/fapi/v1/allOrders',
                           '/fapi/v1/openOrders', '/fapi/v1/userTrades'];
    return signedEndpoints.some(endpoint => url.includes(endpoint));
  }

  private createSignature(query: string): string {
    return createHmac('sha256', this.apiSecret)
      .update(query)
      .digest('hex');
  }

  private buildQueryString(params: Record<string, any>): string {
    return Object.keys(params)
      .filter(key => params[key] !== undefined && params[key] !== null)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');
  }

  /**
   * Test connectivity to the API
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.get('/api/v3/ping');
      return true;
    } catch (error) {
      log.error('Ping failed', error);
      return false;
    }
  }

  /**
   * Get server time
   */
  async getServerTime(): Promise<number> {
    const response = await this.client.get('/api/v3/time');
    return response.data.serverTime;
  }

  /**
   * Get exchange info
   */
  async getExchangeInfo(symbols?: string[]): Promise<ExchangeInfo> {
    const params: any = {};
    if (symbols && symbols.length > 0) {
      params.symbols = JSON.stringify(symbols);
    }

    const response = await this.client.get('/api/v3/exchangeInfo', { params });
    return response.data;
  }

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<number> {
    try {
      const response = await this.client.get<SymbolPriceTicker>('/api/v3/ticker/price', {
        params: { symbol: symbol.toUpperCase() }
      });

      const price = parseFloat(response.data.price);
      log.debug(`Price fetched for ${symbol}`, { price });
      
      return price;
    } catch (error) {
      log.error(`Failed to get price for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Get prices for multiple symbols
   */
  async getPrices(symbols?: string[]): Promise<BinancePriceResponse[]> {
    try {
      const params: any = {};
      if (symbols && symbols.length > 0) {
        params.symbols = JSON.stringify(symbols.map(s => s.toUpperCase()));
      }

      const response = await this.client.get<SymbolPriceTicker[]>('/api/v3/ticker/price', { params });
      
      const prices = Array.isArray(response.data) ? response.data : [response.data];
      log.debug(`Fetched ${prices.length} prices`);

      return prices.map(ticker => ({
        symbol: ticker.symbol,
        price: ticker.price
      }));
    } catch (error) {
      log.error('Failed to get prices', error);
      throw error;
    }
  }

  /**
   * Get 24hr ticker statistics
   */
  async get24hrStats(symbol: string): Promise<Binance24hrResponse> {
    try {
      const response = await this.client.get<Ticker24hr>('/api/v3/ticker/24hr', {
        params: { symbol: symbol.toUpperCase() }
      });

      const stats = response.data;
      log.debug(`24hr stats fetched for ${symbol}`, {
        price: stats.lastPrice,
        change: stats.priceChangePercent
      });

      return {
        symbol: stats.symbol,
        priceChange: stats.priceChange,
        priceChangePercent: stats.priceChangePercent,
        lastPrice: stats.lastPrice,
        volume: stats.volume,
        highPrice: stats.highPrice,
        lowPrice: stats.lowPrice
      };
    } catch (error) {
      log.error(`Failed to get 24hr stats for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Get 24hr stats for multiple symbols
   */
  async get24hrStatsMultiple(symbols?: string[]): Promise<Binance24hrResponse[]> {
    try {
      const params: any = {};
      if (symbols && symbols.length > 0) {
        params.symbols = JSON.stringify(symbols.map(s => s.toUpperCase()));
      }

      const response = await this.client.get<Ticker24hr[]>('/api/v3/ticker/24hr', { params });
      
      const stats = Array.isArray(response.data) ? response.data : [response.data];
      log.debug(`Fetched 24hr stats for ${stats.length} symbols`);

      return stats.map(ticker => ({
        symbol: ticker.symbol,
        priceChange: ticker.priceChange,
        priceChangePercent: ticker.priceChangePercent,
        lastPrice: ticker.lastPrice,
        volume: ticker.volume,
        highPrice: ticker.highPrice,
        lowPrice: ticker.lowPrice
      }));
    } catch (error) {
      log.error('Failed to get 24hr stats', error);
      throw error;
    }
  }

  /**
   * Get order book depth
   */
  async getOrderBook(symbol: string, limit: number = 100): Promise<OrderBook> {
    try {
      const params: OrderBookParams = {
        symbol: symbol.toUpperCase(),
        limit: limit as any
      };

      const response = await this.client.get<OrderBook>('/api/v3/depth', { params });
      
      log.debug(`Order book fetched for ${symbol}`, {
        bids: response.data.bids.length,
        asks: response.data.asks.length
      });

      return response.data;
    } catch (error) {
      log.error(`Failed to get order book for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Get kline/candlestick data
   */
  async getKlines(params: KlinesParams): Promise<Kline[]> {
    try {
      const requestParams = {
        symbol: params.symbol.toUpperCase(),
        interval: params.interval,
        startTime: params.startTime,
        endTime: params.endTime,
        timeZone: params.timeZone,
        limit: params.limit || 500
      };

      const response = await this.client.get('/api/v3/klines', { params: requestParams });
      
      const klines: Kline[] = response.data.map((kline: any[]) => ({
        openTime: kline[0],
        open: kline[1],
        high: kline[2],
        low: kline[3],
        close: kline[4],
        volume: kline[5],
        closeTime: kline[6],
        quoteAssetVolume: kline[7],
        numberOfTrades: kline[8],
        takerBuyBaseAssetVolume: kline[9],
        takerBuyQuoteAssetVolume: kline[10],
        ignore: kline[11]
      }));

      log.debug(`Klines fetched for ${params.symbol}`, {
        interval: params.interval,
        count: klines.length
      });

      return klines;
    } catch (error) {
      log.error(`Failed to get klines for ${params.symbol}`, error);
      throw error;
    }
  }

  /**
   * Get average price
   */
  async getAvgPrice(symbol: string): Promise<{ mins: number; price: string }> {
    try {
      const response = await this.client.get('/api/v3/avgPrice', {
        params: { symbol: symbol.toUpperCase() }
      });

      log.debug(`Average price fetched for ${symbol}`, { price: response.data.price });
      return response.data;
    } catch (error) {
      log.error(`Failed to get average price for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Check if a symbol exists and is trading
   */
  async isSymbolValid(symbol: string): Promise<boolean> {
    try {
      const exchangeInfo = await this.getExchangeInfo([symbol.toUpperCase()]);
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol.toUpperCase());
      
      return symbolInfo?.status === 'TRADING';
    } catch (error) {
      log.debug(`Symbol validation failed for ${symbol}`, error);
      return false;
    }
  }

  /**
   * Get supported trading symbols
   */
  async getTradingSymbols(): Promise<string[]> {
    try {
      const exchangeInfo = await this.getExchangeInfo();
      return exchangeInfo.symbols
        .filter(symbol => symbol.status === 'TRADING')
        .map(symbol => symbol.symbol);
    } catch (error) {
      log.error('Failed to get trading symbols', error);
      throw error;
    }
  }

  // =========================
  // FUTURES API METHODS
  // =========================

  /**
   * Get futures exchange info
   */
  async getFuturesExchangeInfo(): Promise<FuturesExchangeInfo> {
    try {
      const response = await this.futuresClient.get('/fapi/v1/exchangeInfo');
      return response.data;
    } catch (error) {
      log.error('Failed to get futures exchange info', error);
      throw error;
    }
  }

  /**
   * Get futures price for a symbol
   */
  async getFuturesPrice(symbol: string): Promise<number> {
    try {
      const response = await this.futuresClient.get('/fapi/v1/ticker/price', {
        params: { symbol: symbol.toUpperCase() }
      });

      const price = parseFloat(response.data.price);
      log.debug(`Futures price fetched for ${symbol}`, { price });
      
      return price;
    } catch (error) {
      log.error(`Failed to get futures price for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Get futures 24hr statistics
   */
  async getFutures24hrStats(symbol: string): Promise<FuturesTicker24hr> {
    try {
      const response = await this.futuresClient.get('/fapi/v1/ticker/24hr', {
        params: { symbol: symbol.toUpperCase() }
      });

      log.debug(`Futures 24hr stats fetched for ${symbol}`, {
        price: response.data.lastPrice,
        change: response.data.priceChangePercent
      });

      return response.data;
    } catch (error) {
      log.error(`Failed to get futures 24hr stats for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Get multiple futures 24hr statistics
   */
  async getFutures24hrStatsMultiple(symbols?: string[]): Promise<FuturesTicker24hr[]> {
    try {
      if (symbols && symbols.length > 0) {
        // For futures, we need to send individual requests or use the general endpoint
        const response = await this.futuresClient.get('/fapi/v1/ticker/24hr');
        const allStats = response.data as FuturesTicker24hr[];
        const upperSymbols = symbols.map(s => s.toUpperCase());
        return allStats.filter(stat => upperSymbols.includes(stat.symbol));
      }

      const response = await this.futuresClient.get('/fapi/v1/ticker/24hr');
      log.debug(`Fetched futures 24hr stats for all symbols`);

      return response.data;
    } catch (error) {
      log.error('Failed to get futures 24hr stats', error);
      throw error;
    }
  }

  /**
   * Get funding rate for a symbol
   */
  async getFundingRate(symbol: string): Promise<FundingRate> {
    try {
      const response = await this.futuresClient.get('/fapi/v1/fundingRate', {
        params: { 
          symbol: symbol.toUpperCase(),
          limit: 1
        }
      });

      const fundingData = response.data[0];
      log.debug(`Funding rate fetched for ${symbol}`, { rate: fundingData.fundingRate });

      return fundingData;
    } catch (error) {
      log.error(`Failed to get funding rate for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Get all funding rates
   */
  async getAllFundingRates(): Promise<FundingRate[]> {
    try {
      // Get premium index data and funding info in parallel
      const [premiumResponse, fundingInfoResponse] = await Promise.all([
        this.futuresClient.get('/fapi/v1/premiumIndex'),
        this.futuresClient.get('/fapi/v1/fundingInfo')
      ]);
      
      log.debug(`Fetched funding rates for all symbols`);
      
      // Create a map of funding intervals
      const fundingIntervalMap = new Map<string, number>();
      if (fundingInfoResponse.data) {
        fundingInfoResponse.data.forEach((info: any) => {
          fundingIntervalMap.set(info.symbol, info.fundingIntervalHours || 8);
        });
      }
      
      // Convert premium index data to funding rate format with 8h normalization
      return premiumResponse.data.map((item: any) => {
        const currentInterval = fundingIntervalMap.get(item.symbol) || 8;
        const currentRate = parseFloat(item.lastFundingRate);
        
        // Normalize to 8-hour rate: rate_8h = rate_current * (8 / current_interval)
        const normalizedRate = currentRate * (8 / currentInterval);
        
        return {
          symbol: item.symbol,
          fundingRate: normalizedRate.toFixed(8),
          fundingTime: item.nextFundingTime
        };
      });
    } catch (error) {
      log.error('Failed to get all funding rates', error);
      throw error;
    }
  }

  /**
   * Get open interest for a symbol
   */
  async getOpenInterest(symbol: string): Promise<OpenInterest> {
    try {
      const response = await this.futuresClient.get('/fapi/v1/openInterest', {
        params: { symbol: symbol.toUpperCase() }
      });

      log.debug(`Open interest fetched for ${symbol}`, { openInterest: response.data.openInterest });

      return response.data;
    } catch (error) {
      log.error(`Failed to get open interest for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Get open interest statistics
   */
  async getOpenInterestStats(symbol: string, period: '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d' = '1h', limit: number = 30): Promise<OpenInterestStats[]> {
    const cacheKey = `oi:${symbol.toUpperCase()}:${period}:${limit}`;
    
    // Try to get from cache first
    const cached = await oiCache.get(cacheKey);
    if (cached) {
      log.debug(`Open interest stats from cache for ${symbol}`, { period, count: cached.length });
      return cached;
    }

    try {
      const response = await this.futuresClient.get('/futures/data/openInterestHist', {
        params: { 
          symbol: symbol.toUpperCase(),
          period,
          limit
        }
      });

      const data = response.data;
      
      // Cache the result with appropriate TTL
      await oiCache.set(cacheKey, data, CacheManager.TTL.OI_HIST);
      
      log.debug(`Open interest stats fetched for ${symbol}`, { period, count: data.length });

      return data;
    } catch (error) {
      log.error(`Failed to get open interest stats for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * Get futures symbols that are actively trading
   */
  async getFuturesTradingSymbols(): Promise<string[]> {
    const cacheKey = 'futures:trading_symbols';
    
    // Try to get from cache first
    const cached = await marketDataCache.get(cacheKey);
    if (cached) {
      log.debug('Futures trading symbols from cache', { count: cached.length });
      return cached;
    }

    try {
      const exchangeInfo = await this.getFuturesExchangeInfo();
      const symbols = exchangeInfo.symbols
        .filter(symbol => symbol.status === 'TRADING')
        .map(symbol => symbol.symbol);
      
      // Cache with 24-hour TTL since trading symbols change rarely
      await marketDataCache.set(cacheKey, symbols, CacheManager.TTL.SYMBOLS);
      
      log.debug('Futures trading symbols fetched', { count: symbols.length });
      return symbols;
    } catch (error) {
      log.error('Failed to get futures trading symbols', error);
      throw error;
    }
  }

  /**
   * Batch get open interest stats for multiple symbols with rate limiting
   */
  async getBatchOpenInterestStats(
    symbols: string[], 
    period: '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d' = '1h', 
    limit: number = 30,
    batchSize: number = 50,
    delayMs: number = 1000
  ): Promise<Map<string, OpenInterestStats[]>> {
    const results = new Map<string, OpenInterestStats[]>();
    const batches = this.chunkArray(symbols, batchSize);
    
    log.info(`Processing ${symbols.length} symbols in ${batches.length} batches (${batchSize} symbols per batch)`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      log.debug(`Processing batch ${i + 1}/${batches.length} with ${batch.length} symbols`);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (symbol) => {
        try {
          const data = await this.getOpenInterestStats(symbol, period, limit);
          return { symbol, data };
        } catch (error) {
          log.warn(`Failed to get OI stats for ${symbol}`, error);
          return { symbol, data: null };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Collect successful results
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.data) {
          results.set(result.value.symbol, result.value.data);
        }
      });
      
      // Add delay between batches to respect rate limits
      if (i < batches.length - 1) {
        log.debug(`Waiting ${delayMs}ms before next batch...`);
        await this.sleep(delayMs);
      }
    }
    
    log.info(`Batch processing complete. Successfully fetched OI data for ${results.size}/${symbols.length} symbols`);
    return results;
  }

  /**
   * Get symbol precision info for both spot and futures
   */
  async getSymbolPrecision(symbol: string): Promise<{ pricePrecision: number; quantityPrecision: number; source: 'spot' | 'futures' } | null> {
    const cacheKey = `precision:${symbol.toUpperCase()}`;
    
    // Try cache first
    const cached = await marketDataCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Try futures first as it's more commonly used
      const futuresInfo = await this.getFuturesExchangeInfo();
      const futuresSymbol = futuresInfo.symbols.find(s => s.symbol === symbol.toUpperCase());
      
      if (futuresSymbol && futuresSymbol.status === 'TRADING') {
        const result = {
          pricePrecision: futuresSymbol.pricePrecision,
          quantityPrecision: futuresSymbol.quantityPrecision,
          source: 'futures' as const
        };
        
        // Cache with 24-hour TTL
        await marketDataCache.set(cacheKey, result, CacheManager.TTL.SYMBOLS);
        return result;
      }

      // Fallback to spot
      const spotInfo = await this.getExchangeInfo([symbol.toUpperCase()]);
      const spotSymbol = spotInfo.symbols.find(s => s.symbol === symbol.toUpperCase());
      
      if (spotSymbol && spotSymbol.status === 'TRADING') {
        const result = {
          pricePrecision: spotSymbol.baseAssetPrecision, // Use baseAssetPrecision for spot
          quantityPrecision: spotSymbol.quotePrecision,
          source: 'spot' as const
        };
        
        // Cache with 24-hour TTL
        await marketDataCache.set(cacheKey, result, CacheManager.TTL.SYMBOLS);
        return result;
      }

      return null;
    } catch (error) {
      log.debug(`Failed to get precision for ${symbol}`, error);
      return null;
    }
  }

  /**
   * Check if a symbol exists in futures and is trading
   */
  async isFuturesSymbolValid(symbol: string): Promise<boolean> {
    try {
      const exchangeInfo = await this.getFuturesExchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol.toUpperCase());
      
      return symbolInfo?.status === 'TRADING';
    } catch (error) {
      log.debug(`Futures symbol validation failed for ${symbol}`, error);
      return false;
    }
  }

  // Helper methods

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const binanceClient = new BinanceClient();