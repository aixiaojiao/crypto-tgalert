export interface AlertConfig {
  id: string;
  symbol: string;
  type: AlertType;
  condition: AlertCondition;
  thresholds: AlertThreshold;
  enabled: boolean;
  notificationChannels: NotificationChannel[];
  cooldownMs: number;
  maxRetries: number;
  priority: AlertPriority;
  metadata?: Record<string, any>;
}

export enum AlertType {
  PRICE_ABOVE = 'price_above',
  PRICE_BELOW = 'price_below',
  PRICE_CHANGE = 'price_change',
  VOLUME_SPIKE = 'volume_spike',
  FUNDING_RATE = 'funding_rate',
  OPEN_INTEREST = 'open_interest',
  TECHNICAL_INDICATOR = 'technical_indicator',
  BREAKTHROUGH = 'breakthrough',
  MULTI_BREAKTHROUGH = 'multi_breakthrough',
  CUSTOM = 'custom'
}

export enum AlertCondition {
  GREATER_THAN = 'gt',
  LESS_THAN = 'lt',
  EQUALS = 'eq',
  PERCENTAGE_CHANGE = 'pct_change',
  ABSOLUTE_CHANGE = 'abs_change',
  CROSSES_ABOVE = 'crosses_above',
  CROSSES_BELOW = 'crosses_below',
  BREAKS_HIGH = 'breaks_high',
  BREAKS_TIMEFRAME_HIGH = 'breaks_timeframe_high'
}

export interface AlertThreshold {
  value: number;
  timeframeMs?: number;
  referencePrice?: number;
  percentage?: number;
  timeframe?: string; // For breakthrough alerts: '1w', '1m', '6m', '1y', 'all'
}

export enum NotificationChannel {
  TELEGRAM = 'telegram',
  EMAIL = 'email',
  WEBHOOK = 'webhook',
  SMS = 'sms',
  PUSH = 'push'
}

export enum AlertPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface AlertEvent {
  id: string;
  alertId: string;
  symbol: string;
  type: AlertType;
  triggeredAt: Date;
  currentValue: number;
  thresholdValue: number;
  condition: AlertCondition;
  priority: AlertPriority;
  message: string;
  metadata?: Record<string, any>;
}

export interface AlertTriggerResult {
  triggered: boolean;
  event?: AlertEvent;
  reason?: string;
  nextCheckTime?: Date;
}

export interface NotificationResult {
  success: boolean;
  channel: NotificationChannel;
  messageId?: string;
  error?: string;
  retryAfter?: number;
}

export interface IAlertService {
  /**
   * 注册新的报警配置
   */
  registerAlert(config: AlertConfig): Promise<void>;

  /**
   * 更新报警配置
   */
  updateAlert(alertId: string, updates: Partial<AlertConfig>): Promise<void>;

  /**
   * 删除报警配置
   */
  removeAlert(alertId: string): Promise<void>;

  /**
   * 启用/禁用报警
   */
  toggleAlert(alertId: string, enabled: boolean): Promise<void>;

  /**
   * 获取所有报警配置
   */
  getAlerts(): Promise<AlertConfig[]>;

  /**
   * 获取特定报警配置
   */
  getAlert(alertId: string): Promise<AlertConfig | null>;

  /**
   * 检查并触发报警
   */
  checkAlerts(marketData: MarketData): Promise<AlertTriggerResult[]>;

  /**
   * 手动触发报警测试
   */
  testAlert(alertId: string): Promise<NotificationResult[]>;

  /**
   * 获取报警历史
   */
  getAlertHistory(alertId?: string, limit?: number): Promise<AlertEvent[]>;

  /**
   * 清理过期的报警历史
   */
  cleanupHistory(olderThanMs: number): Promise<number>;

  /**
   * 获取报警统计
   */
  getStatistics(): Promise<AlertStatistics>;
}

export interface MarketData {
  symbol: string;
  price: number;
  volume24h?: number;
  priceChange24h?: number;
  priceChangePercent24h?: number;
  high24h?: number;
  low24h?: number;
  timestamp: number;
  [key: string]: any;
}

export interface AlertStatistics {
  totalAlerts: number;
  activeAlerts: number;
  triggeredToday: number;
  triggeredThisWeek: number;
  byType: Record<AlertType, number>;
  byPriority: Record<AlertPriority, number>;
  avgResponseTime: number;
  successRate: number;
}

// Breakthrough Alert specific interfaces
export interface BreakthroughAlertMetadata {
  timeframe: '1w' | '1m' | '6m' | '1y' | 'all';
  watchAllSymbols: boolean;
  lastTriggeredHigh?: number;
  lastTriggeredTime?: string;
  triggeredSymbols?: string[];
  lastCheckPrice?: number; // For deduplication
}

export interface BreakthroughCheckResult {
  symbol: string;
  currentPrice: number;
  timeframeHigh: number;
  highTimestamp: number;
  isBreakthrough: boolean;
  breakAmount: number; // How much above the high
  breakPercentage: number; // Percentage above the high
}