import {
  IAlertService,
  AlertConfig,
  AlertEvent,
  AlertTriggerResult,
  NotificationResult,
  AlertType,
  AlertCondition,
  AlertPriority,
  MarketData,
  AlertStatistics
} from './IAlertService';
import { INotificationService, NotificationContext } from './INotificationService';
import { log } from '../../utils/logger';
export class UnifiedAlertService implements IAlertService {
  private alerts = new Map<string, AlertConfig>();
  private alertHistory: AlertEvent[] = [];
  private lastTriggerTimes = new Map<string, number>();
  private cooldownMap = new Map<string, number>();
  private isProcessing = false;

  constructor(
    protected logger: typeof log,
    private notificationService: INotificationService
  ) {}

  async registerAlert(config: AlertConfig): Promise<void> {
    this.validateAlertConfig(config);
    this.alerts.set(config.id, { ...config });

    this.logger.info('Alert registered', {
      id: config.id,
      symbol: config.symbol,
      type: config.type,
      enabled: config.enabled
    });
  }

  async updateAlert(alertId: string, updates: Partial<AlertConfig>): Promise<void> {
    const existingAlert = this.alerts.get(alertId);
    if (!existingAlert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    const updatedAlert = { ...existingAlert, ...updates };
    this.validateAlertConfig(updatedAlert);
    this.alerts.set(alertId, updatedAlert);

    this.logger.info('Alert updated', { alertId, updates });
  }

  async removeAlert(alertId: string): Promise<void> {
    const removed = this.alerts.delete(alertId);
    if (!removed) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    // 清理相关数据
    this.lastTriggerTimes.delete(alertId);
    this.cooldownMap.delete(alertId);

    this.logger.info('Alert removed', { alertId });
  }

  async toggleAlert(alertId: string, enabled: boolean): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    alert.enabled = enabled;
    this.logger.info('Alert toggled', { alertId, enabled });
  }

  async getAlerts(): Promise<AlertConfig[]> {
    return Array.from(this.alerts.values());
  }

  async getAlert(alertId: string): Promise<AlertConfig | null> {
    return this.alerts.get(alertId) || null;
  }

  async checkAlerts(marketData: MarketData): Promise<AlertTriggerResult[]> {
    if (this.isProcessing) {
      this.logger.debug('Alert processing already in progress, skipping');
      return [];
    }

    this.isProcessing = true;
    const results: AlertTriggerResult[] = [];

    try {
      const symbolAlerts = Array.from(this.alerts.values())
        .filter(alert => alert.enabled && alert.symbol === marketData.symbol);

      for (const alert of symbolAlerts) {
        try {
          const result = await this.checkSingleAlert(alert, marketData);
          results.push(result);

          if (result.triggered && result.event) {
            await this.handleTriggeredAlert(result.event, alert);
          }
        } catch (error) {
          this.logger.error('Error checking alert', {
            alertId: alert.id,
            error: error instanceof Error ? error.message : String(error)
          });

          results.push({
            triggered: false,
            reason: `Check failed: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return results;
  }

  async testAlert(alertId: string): Promise<NotificationResult[]> {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    const testEvent: AlertEvent = {
      id: `test-${Date.now()}`,
      alertId: alert.id,
      symbol: alert.symbol,
      type: alert.type,
      triggeredAt: new Date(),
      currentValue: 0,
      thresholdValue: alert.thresholds.value,
      condition: alert.condition,
      priority: alert.priority,
      message: `Test notification for alert: ${alert.id}`,
      metadata: { test: true }
    };

    return this.sendNotifications(testEvent, alert);
  }

  async getAlertHistory(alertId?: string, limit: number = 100): Promise<AlertEvent[]> {
    let history = this.alertHistory;

    if (alertId) {
      history = history.filter(event => event.alertId === alertId);
    }

    return history
      .sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime())
      .slice(0, limit);
  }

  async cleanupHistory(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    const initialLength = this.alertHistory.length;

    this.alertHistory = this.alertHistory.filter(
      event => event.triggeredAt.getTime() > cutoff
    );

    const removed = initialLength - this.alertHistory.length;
    this.logger.info('Alert history cleaned up', { removed, remaining: this.alertHistory.length });

    return removed;
  }

  async getStatistics(): Promise<AlertStatistics> {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const triggeredToday = this.alertHistory.filter(
      event => event.triggeredAt.getTime() > oneDayAgo
    ).length;

    const triggeredThisWeek = this.alertHistory.filter(
      event => event.triggeredAt.getTime() > oneWeekAgo
    ).length;

    const byType: Record<AlertType, number> = {} as any;
    const byPriority: Record<AlertPriority, number> = {} as any;

    for (const event of this.alertHistory) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      byPriority[event.priority] = (byPriority[event.priority] || 0) + 1;
    }

    return {
      totalAlerts: this.alerts.size,
      activeAlerts: Array.from(this.alerts.values()).filter(a => a.enabled).length,
      triggeredToday,
      triggeredThisWeek,
      byType,
      byPriority,
      avgResponseTime: 0, // TODO: 实现响应时间跟踪
      successRate: 0.95 // TODO: 实现成功率跟踪
    };
  }

  // Private methods

  private async checkSingleAlert(alert: AlertConfig, marketData: MarketData): Promise<AlertTriggerResult> {
    // 检查冷却时间
    if (!this.canTrigger(alert.id, alert.cooldownMs)) {
      return {
        triggered: false,
        reason: 'Still in cooldown period',
        nextCheckTime: new Date(this.getNextCheckTime(alert.id, alert.cooldownMs))
      };
    }

    // 评估触发条件
    const shouldTrigger = this.evaluateCondition(alert, marketData);

    if (!shouldTrigger) {
      return {
        triggered: false,
        reason: 'Condition not met'
      };
    }

    // 创建报警事件
    const event: AlertEvent = {
      id: `${alert.id}-${Date.now()}`,
      alertId: alert.id,
      symbol: alert.symbol,
      type: alert.type,
      triggeredAt: new Date(),
      currentValue: marketData.price,
      thresholdValue: alert.thresholds.value,
      condition: alert.condition,
      priority: alert.priority,
      message: this.generateAlertMessage(alert, marketData),
      metadata: { marketData }
    };

    return {
      triggered: true,
      event
    };
  }

  protected async handleTriggeredAlert(event: AlertEvent, alert: AlertConfig): Promise<void> {
    // 记录触发时间
    this.lastTriggerTimes.set(alert.id, Date.now());
    this.cooldownMap.set(alert.id, Date.now() + alert.cooldownMs);

    // 添加到历史记录
    this.alertHistory.push(event);

    // 限制历史记录大小
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-500);
    }

    // 发送通知
    try {
      await this.sendNotifications(event, alert);
      this.logger.info('Alert notifications sent', { alertId: alert.id, eventId: event.id });
    } catch (error) {
      this.logger.error('Failed to send alert notifications', {
        alertId: alert.id,
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async sendNotifications(event: AlertEvent, alert: AlertConfig): Promise<NotificationResult[]> {
    const context: NotificationContext = {
      event,
      metadata: { alert }
    };

    return this.notificationService.sendBulkNotifications(
      alert.notificationChannels,
      context
    );
  }

  private canTrigger(alertId: string, cooldownMs: number): boolean {
    const lastTrigger = this.lastTriggerTimes.get(alertId);
    if (!lastTrigger) {
      return true;
    }

    return Date.now() - lastTrigger >= cooldownMs;
  }

  private getNextCheckTime(alertId: string, cooldownMs: number): number {
    const lastTrigger = this.lastTriggerTimes.get(alertId);
    return lastTrigger ? lastTrigger + cooldownMs : Date.now();
  }

  private evaluateCondition(alert: AlertConfig, marketData: MarketData): boolean {
    const { condition, thresholds } = alert;
    const currentValue = this.extractValue(alert.type, marketData);

    switch (condition) {
      case AlertCondition.GREATER_THAN:
        return currentValue > thresholds.value;

      case AlertCondition.LESS_THAN:
        return currentValue < thresholds.value;

      case AlertCondition.EQUALS:
        return Math.abs(currentValue - thresholds.value) < 0.0001;

      case AlertCondition.PERCENTAGE_CHANGE:
        if (!thresholds.referencePrice) return false;
        const changePercent = ((currentValue - thresholds.referencePrice) / thresholds.referencePrice) * 100;
        return Math.abs(changePercent) >= thresholds.value;

      case AlertCondition.ABSOLUTE_CHANGE:
        if (!thresholds.referencePrice) return false;
        const absoluteChange = Math.abs(currentValue - thresholds.referencePrice);
        return absoluteChange >= thresholds.value;

      case AlertCondition.CROSSES_ABOVE:
        // TODO: 实现交叉逻辑，需要历史数据
        return currentValue > thresholds.value;

      case AlertCondition.CROSSES_BELOW:
        // TODO: 实现交叉逻辑，需要历史数据
        return currentValue < thresholds.value;

      default:
        return false;
    }
  }

  private extractValue(alertType: AlertType, marketData: MarketData): number {
    switch (alertType) {
      case AlertType.PRICE_ABOVE:
      case AlertType.PRICE_BELOW:
        return marketData.price;

      case AlertType.PRICE_CHANGE:
        return marketData.priceChangePercent24h || 0;

      case AlertType.VOLUME_SPIKE:
        return marketData.volume24h || 0;

      default:
        return marketData.price;
    }
  }

  private generateAlertMessage(alert: AlertConfig, marketData: MarketData): string {
    const currentValue = this.extractValue(alert.type, marketData);
    const symbol = alert.symbol;

    switch (alert.type) {
      case AlertType.PRICE_ABOVE:
        return `🚨 ${symbol} price is above ${alert.thresholds.value}! Current: ${currentValue}`;

      case AlertType.PRICE_BELOW:
        return `🚨 ${symbol} price is below ${alert.thresholds.value}! Current: ${currentValue}`;

      case AlertType.PRICE_CHANGE:
        return `🚨 ${symbol} price changed by ${currentValue}% in 24h! Threshold: ${alert.thresholds.value}%`;

      case AlertType.VOLUME_SPIKE:
        return `🚨 ${symbol} volume spike detected! Current: ${currentValue}, Threshold: ${alert.thresholds.value}`;

      default:
        return `🚨 ${symbol} alert triggered! Current value: ${currentValue}`;
    }
  }

  private validateAlertConfig(config: AlertConfig): void {
    if (!config.id || typeof config.id !== 'string') {
      throw new Error('Alert ID is required and must be a string');
    }

    if (!config.symbol || typeof config.symbol !== 'string') {
      throw new Error('Symbol is required and must be a string');
    }

    if (!Object.values(AlertType).includes(config.type)) {
      throw new Error(`Invalid alert type: ${config.type}`);
    }

    if (!Object.values(AlertCondition).includes(config.condition)) {
      throw new Error(`Invalid alert condition: ${config.condition}`);
    }

    if (typeof config.thresholds.value !== 'number' || isNaN(config.thresholds.value)) {
      throw new Error('Threshold value must be a valid number');
    }

    if (config.cooldownMs < 1000) {
      throw new Error('Cooldown must be at least 1000ms');
    }

    if (!Array.isArray(config.notificationChannels) || config.notificationChannels.length === 0) {
      throw new Error('At least one notification channel is required');
    }
  }
}