import {
  INotificationService,
  NotificationTemplate,
  NotificationConfig,
  NotificationContext,
  NotificationHistoryItem
} from './INotificationService';
import {
  NotificationChannel,
  NotificationResult,
  AlertPriority
} from './IAlertService';
import { log } from '../../utils/logger';

export class NotificationService implements INotificationService {
  private templates = new Map<string, NotificationTemplate>();
  private configs = new Map<NotificationChannel, NotificationConfig>();
  private history: NotificationHistoryItem[] = [];
  private rateLimitMap = new Map<string, number>();
  private telegramBot: any; // TelegramBot instance

  constructor(
    private logger: typeof log
  ) {
    this.initializeDefaultConfigs();
    this.initializeDefaultTemplates();
  }

  /**
   * 设置Telegram Bot实例
   */
  setTelegramBot(bot: any): void {
    this.telegramBot = bot;
  }

  async sendNotification(
    channel: NotificationChannel,
    context: NotificationContext
  ): Promise<NotificationResult> {
    const config = this.configs.get(channel);
    if (!config || !config.enabled) {
      return {
        success: false,
        channel,
        error: `Channel ${channel} is not configured or disabled`
      };
    }

    // 检查速率限制
    if (!(await this.checkRateLimit(channel))) {
      return {
        success: false,
        channel,
        error: 'Rate limit exceeded',
        retryAfter: config.rateLimitMs
      };
    }

    const message = await this.formatMessage(context);
    let result: NotificationResult;

    try {
      switch (channel) {
        case NotificationChannel.TELEGRAM:
          result = await this.sendTelegramNotification(message, context);
          break;

        case NotificationChannel.EMAIL:
          result = await this.sendEmailNotification(message, context);
          break;

        case NotificationChannel.WEBHOOK:
          result = await this.sendWebhookNotification(message, context);
          break;

        case NotificationChannel.SMS:
          result = await this.sendSMSNotification(message, context);
          break;

        case NotificationChannel.PUSH:
          result = await this.sendPushNotification(message, context);
          break;

        default:
          result = {
            success: false,
            channel,
            error: `Unsupported channel: ${channel}`
          };
      }

      // 记录发送历史
      this.recordNotification(result, context);

      // 更新速率限制
      this.updateRateLimit(channel);

      return result;

    } catch (error) {
      const errorResult: NotificationResult = {
        success: false,
        channel,
        error: error instanceof Error ? error.message : String(error)
      };

      this.recordNotification(errorResult, context);
      return errorResult;
    }
  }

  async sendBulkNotifications(
    channels: NotificationChannel[],
    context: NotificationContext
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    for (const channel of channels) {
      try {
        const result = await this.sendNotification(channel, context);
        results.push(result);

        // 如果发送失败且有重试配置，进行重试
        if (!result.success && this.shouldRetry(channel, context)) {
          const retryResult = await this.retryNotification(channel, context);
          if (retryResult.success) {
            results[results.length - 1] = retryResult;
          }
        }
      } catch (error) {
        results.push({
          success: false,
          channel,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  }

  async registerTemplate(template: NotificationTemplate): Promise<void> {
    const key = `${template.channel}-${template.alertType}-${template.priority}`;
    this.templates.set(key, template);

    this.logger.info('Notification template registered', {
      id: template.id,
      channel: template.channel,
      alertType: template.alertType
    });
  }

  async updateConfig(channel: NotificationChannel, config: NotificationConfig): Promise<void> {
    this.configs.set(channel, config);

    this.logger.info('Notification config updated', {
      channel,
      enabled: config.enabled,
      rateLimitMs: config.rateLimitMs
    });
  }

  async getConfig(channel: NotificationChannel): Promise<NotificationConfig | null> {
    return this.configs.get(channel) || null;
  }

  async testChannel(channel: NotificationChannel, testMessage: string): Promise<NotificationResult> {
    const testContext: NotificationContext = {
      event: {
        id: 'test',
        alertId: 'test',
        symbol: 'TEST',
        type: 'custom' as any,
        triggeredAt: new Date(),
        currentValue: 0,
        thresholdValue: 0,
        condition: 'gt' as any,
        priority: AlertPriority.MEDIUM,
        message: testMessage,
        metadata: { test: true }
      }
    };

    return this.sendNotification(channel, testContext);
  }

  async getNotificationHistory(limit: number = 100): Promise<NotificationHistoryItem[]> {
    return this.history
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, limit);
  }

  async formatMessage(context: NotificationContext): Promise<string> {
    const { event, template } = context;

    if (template) {
      return this.applyTemplate(template, event);
    }

    // 寻找匹配的模板
    const templateKey = `${NotificationChannel.TELEGRAM}-${event.type}-${event.priority}`;
    const foundTemplate = this.templates.get(templateKey);

    if (foundTemplate) {
      return this.applyTemplate(foundTemplate, event);
    }

    // 使用默认格式
    return this.getDefaultMessage(event);
  }

  async checkRateLimit(channel: NotificationChannel): Promise<boolean> {
    const config = this.configs.get(channel);
    if (!config) return false;

    const now = Date.now();
    const lastSent = this.rateLimitMap.get(channel);

    if (!lastSent) return true;

    return now - lastSent >= config.rateLimitMs;
  }

  // Private methods

  private initializeDefaultConfigs(): void {
    const defaultConfig: NotificationConfig = {
      channel: NotificationChannel.TELEGRAM,
      enabled: true,
      rateLimitMs: 5000, // 5 seconds
      maxRetries: 3,
      retryDelayMs: 1000,
      settings: {}
    };

    for (const channel of Object.values(NotificationChannel)) {
      this.configs.set(channel, { ...defaultConfig, channel });
    }
  }

  private initializeDefaultTemplates(): void {
    const telegramTemplate: NotificationTemplate = {
      id: 'telegram-default',
      channel: NotificationChannel.TELEGRAM,
      alertType: 'default',
      priority: AlertPriority.MEDIUM,
      template: `🚨 *{{alertType}}* Alert

📊 *Symbol:* {{symbol}}
💰 *Current Price:* {{currentValue}}
🎯 *Threshold:* {{thresholdValue}}
📈 *Condition:* {{condition}}
⏰ *Time:* {{triggeredAt}}

{{message}}`,
      variables: ['alertType', 'symbol', 'currentValue', 'thresholdValue', 'condition', 'triggeredAt', 'message']
    };

    this.templates.set('telegram-default-medium', telegramTemplate);
  }

  private async sendTelegramNotification(
    message: string,
    context: NotificationContext
  ): Promise<NotificationResult> {
    try {
      if (!this.telegramBot) {
        throw new Error('Telegram bot not configured');
      }

      // 从context中获取chatId，或使用默认的授权用户
      const chatId = context.metadata?.alert?.metadata?.chatId || this.telegramBot.getAuthorizedUserId();

      if (!chatId) {
        throw new Error('No valid chat ID available for notification');
      }

      this.logger.info('Sending Telegram notification', {
        alertId: context.event.alertId,
        chatId,
        messageLength: message.length
      });

      // 发送消息
      await this.telegramBot.sendMessage(chatId, message);

      return {
        success: true,
        channel: NotificationChannel.TELEGRAM,
        messageId: `tg-${Date.now()}`
      };
    } catch (error) {
      this.logger.error('Failed to send Telegram notification', {
        alertId: context.event.alertId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        channel: NotificationChannel.TELEGRAM,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async sendEmailNotification(
    _message: string,
    context: NotificationContext
  ): Promise<NotificationResult> {
    // TODO: 实现邮件发送
    this.logger.debug('Email notification not implemented', { alertId: context.event.alertId });
    return {
      success: false,
      channel: NotificationChannel.EMAIL,
      error: 'Email notifications not implemented'
    };
  }

  private async sendWebhookNotification(
    _message: string,
    context: NotificationContext
  ): Promise<NotificationResult> {
    // TODO: 实现Webhook发送
    this.logger.debug('Webhook notification not implemented', { alertId: context.event.alertId });
    return {
      success: false,
      channel: NotificationChannel.WEBHOOK,
      error: 'Webhook notifications not implemented'
    };
  }

  private async sendSMSNotification(
    _message: string,
    context: NotificationContext
  ): Promise<NotificationResult> {
    // TODO: 实现SMS发送
    this.logger.debug('SMS notification not implemented', { alertId: context.event.alertId });
    return {
      success: false,
      channel: NotificationChannel.SMS,
      error: 'SMS notifications not implemented'
    };
  }

  private async sendPushNotification(
    _message: string,
    context: NotificationContext
  ): Promise<NotificationResult> {
    // TODO: 实现推送通知
    this.logger.debug('Push notification not implemented', { alertId: context.event.alertId });
    return {
      success: false,
      channel: NotificationChannel.PUSH,
      error: 'Push notifications not implemented'
    };
  }

  private applyTemplate(template: NotificationTemplate, event: any): string {
    let message = template.template;

    for (const variable of template.variables) {
      const value = this.getVariableValue(variable, event);
      const placeholder = `{{${variable}}}`;
      message = message.replace(new RegExp(placeholder, 'g'), String(value));
    }

    return message;
  }

  private getVariableValue(variable: string, event: any): any {
    switch (variable) {
      case 'alertType':
        return event.type.replace('_', ' ').toUpperCase();
      case 'triggeredAt':
        return event.triggeredAt.toLocaleString();
      default:
        return event[variable] || '';
    }
  }

  private getDefaultMessage(event: any): string {
    return `🚨 Alert: ${event.symbol} ${event.type} - Current: ${event.currentValue}, Threshold: ${event.thresholdValue}`;
  }

  private shouldRetry(channel: NotificationChannel, context: NotificationContext): boolean {
    const config = this.configs.get(channel);
    if (!config) return false;

    const retryCount = context.retryCount || 0;
    return retryCount < config.maxRetries;
  }

  private async retryNotification(
    channel: NotificationChannel,
    context: NotificationContext
  ): Promise<NotificationResult> {
    const config = this.configs.get(channel)!;
    const retryCount = (context.retryCount || 0) + 1;

    // 等待重试延迟
    await new Promise(resolve => setTimeout(resolve, config.retryDelayMs * retryCount));

    const retryContext = { ...context, retryCount };
    return this.sendNotification(channel, retryContext);
  }

  private recordNotification(result: NotificationResult, context: NotificationContext): void {
    const historyItem: NotificationHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      channel: result.channel,
      alertId: context.event.alertId,
      ...(result.messageId && { messageId: result.messageId }),
      sentAt: new Date(),
      success: result.success,
      ...(result.error && { error: result.error }),
      retryCount: context.retryCount || 0
    };

    this.history.push(historyItem);

    // 限制历史记录大小
    if (this.history.length > 1000) {
      this.history = this.history.slice(-500);
    }
  }

  private updateRateLimit(channel: NotificationChannel): void {
    this.rateLimitMap.set(channel, Date.now());
  }
}