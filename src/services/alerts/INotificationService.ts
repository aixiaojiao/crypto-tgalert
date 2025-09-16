import { NotificationChannel, AlertEvent, NotificationResult, AlertPriority } from './IAlertService';

export interface NotificationTemplate {
  id: string;
  channel: NotificationChannel;
  alertType: string;
  priority: AlertPriority;
  template: string;
  variables: string[];
}

export interface NotificationConfig {
  channel: NotificationChannel;
  enabled: boolean;
  rateLimitMs: number;
  maxRetries: number;
  retryDelayMs: number;
  settings: Record<string, any>;
}

export interface NotificationContext {
  event: AlertEvent;
  template?: NotificationTemplate;
  metadata?: Record<string, any>;
  retryCount?: number;
}

export interface INotificationService {
  /**
   * 发送通知
   */
  sendNotification(
    channel: NotificationChannel,
    context: NotificationContext
  ): Promise<NotificationResult>;

  /**
   * 批量发送通知
   */
  sendBulkNotifications(
    channels: NotificationChannel[],
    context: NotificationContext
  ): Promise<NotificationResult[]>;

  /**
   * 注册通知模板
   */
  registerTemplate(template: NotificationTemplate): Promise<void>;

  /**
   * 更新通知配置
   */
  updateConfig(channel: NotificationChannel, config: NotificationConfig): Promise<void>;

  /**
   * 获取通知配置
   */
  getConfig(channel: NotificationChannel): Promise<NotificationConfig | null>;

  /**
   * 测试通知渠道
   */
  testChannel(channel: NotificationChannel, testMessage: string): Promise<NotificationResult>;

  /**
   * 获取通知历史
   */
  getNotificationHistory(limit?: number): Promise<NotificationHistoryItem[]>;

  /**
   * 格式化消息
   */
  formatMessage(context: NotificationContext): Promise<string>;

  /**
   * 检查速率限制
   */
  checkRateLimit(channel: NotificationChannel): Promise<boolean>;
}

export interface NotificationHistoryItem {
  id: string;
  channel: NotificationChannel;
  alertId: string;
  messageId?: string;
  sentAt: Date;
  success: boolean;
  error?: string;
  retryCount: number;
}