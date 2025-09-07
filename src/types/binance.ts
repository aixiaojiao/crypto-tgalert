/**
 * Binance REST API Types
 * Based on Binance API documentation: https://binance-docs.github.io/apidocs/spot/en/
 */

// Base types
export interface BinanceApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface BinanceError {
  code: number;
  msg: string;
}

// Symbol price ticker
export interface SymbolPriceTicker {
  symbol: string;
  price: string;
}

// 24hr ticker statistics
export interface Ticker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

// Order book depth
export interface OrderBook {
  lastUpdateId: number;
  bids: Array<[string, string]>; // [price, quantity]
  asks: Array<[string, string]>; // [price, quantity]
}

// Kline/Candlestick data
export type KlineInterval = 
  | '1s' | '1m' | '3m' | '5m' | '15m' | '30m' 
  | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' 
  | '1d' | '3d' | '1w' | '1M';

export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteAssetVolume: string;
  numberOfTrades: number;
  takerBuyBaseAssetVolume: string;
  takerBuyQuoteAssetVolume: string;
  ignore: string;
}

// Exchange info types
export interface ExchangeFilter {
  filterType: string;
  [key: string]: any;
}

export interface SymbolFilter extends ExchangeFilter {
  filterType: 'PRICE_FILTER' | 'PERCENT_PRICE' | 'LOT_SIZE' | 'MIN_NOTIONAL' | 'ICEBERG_PARTS' | 'MARKET_LOT_SIZE' | 'MAX_NUM_ORDERS' | 'MAX_NUM_ALGO_ORDERS' | 'MAX_NUM_ICEBERG_ORDERS' | 'MAX_POSITION' | 'TRAILING_DELTA';
}

export interface Symbol {
  symbol: string;
  status: 'TRADING' | 'PRE_TRADING' | 'POST_TRADING' | 'END_OF_DAY' | 'HALT' | 'AUCTION_MATCH' | 'BREAK';
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  quoteAssetPrecision: number;
  baseCommissionPrecision: number;
  quoteCommissionPrecision: number;
  orderTypes: string[];
  icebergAllowed: boolean;
  ocoAllowed: boolean;
  quoteOrderQtyMarketAllowed: boolean;
  allowTrailingStop: boolean;
  cancelReplaceAllowed: boolean;
  isSpotTradingAllowed: boolean;
  isMarginTradingAllowed: boolean;
  filters: SymbolFilter[];
  permissions: string[];
}

export interface ExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: RateLimit[];
  exchangeFilters: ExchangeFilter[];
  symbols: Symbol[];
}

export interface RateLimit {
  rateLimitType: 'REQUEST_WEIGHT' | 'ORDERS' | 'RAW_REQUESTS';
  interval: 'SECOND' | 'MINUTE' | 'DAY';
  intervalNum: number;
  limit: number;
}

// Futures trading types
export interface FuturesSymbolInfo {
  symbol: string;
  pair: string;
  contractType: 'PERPETUAL' | 'CURRENT_MONTH' | 'NEXT_MONTH' | 'CURRENT_QUARTER' | 'NEXT_QUARTER';
  deliveryDate: number;
  onboardDate: number;
  status: 'TRADING' | 'PRE_TRADING' | 'DELIVERING' | 'DELIVERED' | 'PRE_SETTLE' | 'SETTLING' | 'CLOSE';
  maintMarginPercent: string;
  requiredMarginPercent: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  baseAssetPrecision: number;
  quotePrecision: number;
  underlyingType: string;
  underlyingSubType: string[];
  settlePlan: number;
  triggerProtect: string;
  liquidationFee: string;
  marketTakeBound: string;
  maxMoveOrderLimit: number;
}

export interface FuturesExchangeInfo {
  exchangeFilters: any[];
  rateLimits: RateLimit[];
  serverTime: number;
  assets: any[];
  symbols: FuturesSymbolInfo[];
  timezone: string;
}

export interface FuturesTicker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  lastQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export interface FundingRate {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
  markPrice: string;
}

export interface OpenInterest {
  symbol: string;
  openInterest: string;
  time: number;
}

export interface OpenInterestStats {
  symbol: string;
  sumOpenInterest: string;
  sumOpenInterestValue: string;
  timestamp: number;
}

export interface TopLongShortAccountRatio {
  symbol: string;
  longShortRatio: string;
  longAccount: string;
  shortAccount: string;
  timestamp: number;
}

export interface TopLongShortPositionRatio {
  symbol: string;
  longShortRatio: string;
  longPosition: string;
  shortPosition: string;
  timestamp: number;
}

// API Request parameters
export interface PriceTickerParams {
  symbol?: string;
  symbols?: string[];
}

export interface Ticker24hrParams {
  symbol?: string;
  symbols?: string[];
  type?: 'FULL' | 'MINI';
}

export interface OrderBookParams {
  symbol: string;
  limit?: 5 | 10 | 20 | 50 | 100 | 500 | 1000 | 5000;
}

export interface KlinesParams {
  symbol: string;
  interval: KlineInterval;
  startTime?: number;
  endTime?: number;
  timeZone?: string;
  limit?: number; // Default 500; max 1000
}

// API Configuration
export interface BinanceApiConfig {
  apiKey?: string;
  apiSecret?: string;
  baseURL?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  rateLimitRequests?: number;
  rateLimitWindow?: number; // in milliseconds
  enableLogging?: boolean;
}

// Rate limiting types
export interface RateLimitState {
  tokens: number;
  lastRefill: number;
  queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timestamp: number;
  }>;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  maxQueueSize?: number;
  queueTimeoutMs?: number;
}

// Error types
export enum BinanceErrorCode {
  UNKNOWN = -1000,
  DISCONNECTED = -1001,
  UNAUTHORIZED = -1002,
  TOO_MANY_REQUESTS = -1003,
  UNEXPECTED_RESP = -1006,
  TIMEOUT = -1007,
  INVALID_MESSAGE = -1013,
  UNKNOWN_ORDER_COMPOSITION = -1014,
  TOO_MANY_ORDERS = -1015,
  SERVICE_SHUTTING_DOWN = -1016,
  UNSUPPORTED_OPERATION = -1020,
  INVALID_TIMESTAMP = -1021,
  INVALID_SIGNATURE = -1022,
  ILLEGAL_CHARS = -1100,
  TOO_MANY_PARAMETERS = -1101,
  MANDATORY_PARAM_EMPTY_OR_MALFORMED = -1102,
  UNKNOWN_PARAM = -1103,
  UNREAD_PARAMETERS = -1104,
  PARAM_EMPTY = -1105,
  PARAM_NOT_REQUIRED = -1106,
  BAD_PRECISION = -1111,
  NO_DEPTH = -1112,
  TIF_NOT_REQUIRED = -1114,
  INVALID_TIF = -1115,
  INVALID_ORDER_TYPE = -1116,
  INVALID_SIDE = -1117,
  EMPTY_NEW_CL_ORD_ID = -1118,
  EMPTY_ORG_CL_ORD_ID = -1119,
  BAD_INTERVAL = -1120,
  BAD_SYMBOL = -1121,
  INVALID_LISTEN_KEY = -1125,
  MORE_THAN_XX_HOURS = -1127,
  OPTIONAL_PARAMS_BAD_COMBO = -1128,
  INVALID_PARAMETER = -1130,
  BAD_API_ID = -2008,
  DUPLICATE_API_KEY_DESC = -2009,
  INSUFFICIENT_BALANCE = -2010,
  CANCEL_ALL_FAIL = -2012,
  NO_SUCH_ORDER = -2013,
  BAD_API_KEY_FMT = -2014,
  REJECTED_MBX_KEY = -2015
}

export class BinanceApiError extends Error {
  code: number;
  
  constructor(message: string, code: number = BinanceErrorCode.UNKNOWN) {
    super(message);
    this.name = 'BinanceApiError';
    this.code = code;
  }
}

// Request/Response logging types
export interface RequestLog {
  url: string;
  method: string;
  headers: Record<string, string>;
  timestamp: number;
  rateLimitUsed: boolean;
}

export interface ResponseLog extends RequestLog {
  status: number;
  responseTime: number;
  rateLimitRemaining?: number;
  error?: string;
}