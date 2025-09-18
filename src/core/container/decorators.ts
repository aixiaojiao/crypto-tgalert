import 'reflect-metadata';
import { ServiceIdentifier, ServiceLifetime } from './IContainer';

// Metadata keys
export const INJECTABLE_METADATA_KEY = Symbol('injectable');
export const INJECT_METADATA_KEY = Symbol('inject');
export const PARAM_TYPES_METADATA_KEY = Symbol('design:paramtypes');

/**
 * 标记类为可注入的
 */
export function Injectable(lifetime: ServiceLifetime = ServiceLifetime.TRANSIENT) {
  return function <T extends new (...args: any[]) => any>(target: T): T {
    Reflect.defineMetadata(INJECTABLE_METADATA_KEY, { lifetime }, target);
    return target;
  };
}

/**
 * 注入特定的服务
 */
export function Inject(identifier: ServiceIdentifier) {
  return function (target: any, _propertyKey: string | symbol | undefined, parameterIndex: number) {
    const existingTokens = Reflect.getMetadata(INJECT_METADATA_KEY, target) || [];
    existingTokens[parameterIndex] = identifier;
    Reflect.defineMetadata(INJECT_METADATA_KEY, existingTokens, target);
  };
}

/**
 * 标记为单例服务
 */
export function Singleton<T extends new (...args: any[]) => any>(target: T): T {
  return Injectable(ServiceLifetime.SINGLETON)(target);
}

/**
 * 标记为作用域服务
 */
export function Scoped<T extends new (...args: any[]) => any>(target: T): T {
  return Injectable(ServiceLifetime.SCOPED)(target);
}

/**
 * 标记为瞬态服务（默认）
 */
export function Transient<T extends new (...args: any[]) => any>(target: T): T {
  return Injectable(ServiceLifetime.TRANSIENT)(target);
}

/**
 * 从类中提取依赖信息
 */
export function getDependencies(target: any): ServiceIdentifier[] {
  // 首先尝试获取通过 @Inject 装饰器指定的依赖
  const injectTokens = Reflect.getMetadata(INJECT_METADATA_KEY, target) || [];

  // 获取构造函数参数类型
  const paramTypes = Reflect.getMetadata(PARAM_TYPES_METADATA_KEY, target) || [];

  // 合并依赖信息
  const dependencies: ServiceIdentifier[] = [];

  for (let i = 0; i < paramTypes.length; i++) {
    if (injectTokens[i]) {
      // 使用 @Inject 指定的标识符
      dependencies[i] = injectTokens[i];
    } else if (paramTypes[i]) {
      // 使用参数类型作为标识符
      dependencies[i] = paramTypes[i];
    }
  }

  return dependencies;
}

/**
 * 获取可注入元数据
 */
export function getInjectableMetadata(target: any): { lifetime: ServiceLifetime } | null {
  return Reflect.getMetadata(INJECTABLE_METADATA_KEY, target) || null;
}

/**
 * 检查类是否标记为可注入的
 */
export function isInjectable(target: any): boolean {
  return Reflect.hasMetadata(INJECTABLE_METADATA_KEY, target);
}

// 服务标识符常量
export const SERVICE_IDENTIFIERS = {
  // Core services
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  DATABASE_CONNECTION: Symbol('DatabaseConnection'),

  // Foundation Layer (基础层 - 无依赖)
  BINANCE_RATE_LIMITER: Symbol('BinanceRateLimiter'),
  PRICE_CACHE: Symbol('PriceCache'),
  MARKET_DATA_CACHE: Symbol('MarketDataCache'),
  OI_CACHE: Symbol('OICache'),
  FUNDING_CACHE: Symbol('FundingCache'),
  VOLUME_CLASSIFIER: Symbol('VolumeClassifier'),

  // Data services
  DATA_MANAGER: Symbol('DataManager'),
  BINANCE_CLIENT: Symbol('BinanceClient'),
  TIERED_DATA_MANAGER: Symbol('TieredDataManager'),
  BINANCE_WEBSOCKET_CLIENT: Symbol('BinanceWebSocketClient'),

  // Business Layer (业务层 - 有依赖)
  REALTIME_MARKET_CACHE: Symbol('RealtimeMarketCache'),
  HISTORICAL_HIGH_CACHE: Symbol('HistoricalHighCache'),
  RANKING_ANALYZER: Symbol('RankingAnalyzer'),

  // Application Layer (应用层 - 复合依赖)
  PRICE_MONITOR_SERVICE: Symbol('PriceMonitorService'),
  TRIGGER_ALERT_SERVICE: Symbol('TriggerAlertService'),
  REALTIME_ALERT_SERVICE: Symbol('RealtimeAlertService'),

  // Legacy service identifiers (保持兼容性)
  PRICE_ALERT_SERVICE: Symbol('PriceAlertService'),
  MARKET_DATA_SERVICE: Symbol('MarketDataService'),
  TELEGRAM_BOT_SERVICE: Symbol('TelegramBotService'),

  // Repositories
  PRICE_ALERT_REPOSITORY: Symbol('PriceAlertRepository'),
  USER_REPOSITORY: Symbol('UserRepository'),

  // External services
  NOTIFICATION_SERVICE: Symbol('NotificationService'),
  WEBSOCKET_SERVICE: Symbol('WebSocketService'),

  // Technical Indicators Engine (技术指标引擎)
  TECHNICAL_INDICATOR_ENGINE: Symbol('TechnicalIndicatorEngine'),
  INDICATOR_REGISTRY: Symbol('IndicatorRegistry'),
  SIGNAL_ANALYZER: Symbol('SignalAnalyzer'),

  // Technical Indicators Data Services (技术指标数据服务)
  OHLCV_DATA_SERVICE: Symbol('OHLCVDataService'),
  INDICATOR_CACHE_SERVICE: Symbol('IndicatorCacheService'),

  // Core Technical Indicators (核心技术指标)
  RSI_INDICATOR: Symbol('RSIIndicator'),
  MACD_INDICATOR: Symbol('MACDIndicator'),
  MA_INDICATOR: Symbol('MAIndicator'),
  BOLLINGER_BANDS: Symbol('BollingerBands'),
  KDJ_INDICATOR: Symbol('KDJIndicator'),
  WILLIAMS_R_INDICATOR: Symbol('WilliamsRIndicator'),

  // Advanced Technical Analysis (高级技术分析)
  PATTERN_ANALYZER: Symbol('PatternAnalyzer'),
  SUPPORT_RESISTANCE_ANALYZER: Symbol('SupportResistanceAnalyzer'),
  DIVERGENCE_ANALYZER: Symbol('DivergenceAnalyzer'),
  MULTI_TIMEFRAME_ANALYZER: Symbol('MultiTimeFrameAnalyzer'),

  // User Filter Management System (用户过滤管理系统)
  USER_FILTER_SERVICE: Symbol('UserFilterService'),
  ADVANCED_FILTER_MANAGER: Symbol('AdvancedFilterManager')
} as const;

export type ServiceIdentifiers = typeof SERVICE_IDENTIFIERS;