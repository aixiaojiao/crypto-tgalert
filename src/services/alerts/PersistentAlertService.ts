import { UnifiedAlertService } from './UnifiedAlertService';
import { UnifiedAlertModel } from '../../models/UnifiedAlert';
import { AlertConfig, AlertEvent, IAlertService } from './IAlertService';
import { INotificationService } from './INotificationService';
import { log } from '../../utils/logger';
import { startBusinessOperation, endBusinessOperation } from '../../utils/businessMonitor';

/**
 * 持久化警报服务，扩展UnifiedAlertService并添加数据库持久化功能
 */
export class PersistentAlertService extends UnifiedAlertService implements IAlertService {
  private isInitialized = false;

  constructor(
    logger: typeof log,
    notificationService: INotificationService
  ) {
    super(logger, notificationService);
  }

  /**
   * 初始化服务并加载现有警报
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // 初始化数据库
      await UnifiedAlertModel.initDatabase();

      // 加载现有警报到内存
      const alerts = await UnifiedAlertModel.loadAlerts();
      for (const alert of alerts) {
        // 使用父类方法添加到内存中，但不重复保存到数据库
        await super.registerAlert(alert);
      }

      this.isInitialized = true;
      this.logger.info('PersistentAlertService initialized', { loadedAlerts: alerts.length });
    } catch (error) {
      this.logger.error('Failed to initialize PersistentAlertService:', error);
      throw error;
    }
  }

  /**
   * 注册新警报（带持久化）
   */
  async registerAlert(config: AlertConfig): Promise<void> {
    const operationId = startBusinessOperation('alert_register', {
      alertType: config.type,
      symbol: config.symbol
    });

    try {
      // 先保存到数据库
      await UnifiedAlertModel.saveAlert(config);

      // 然后添加到内存中
      await super.registerAlert(config);

      endBusinessOperation(operationId, true, undefined, {
        alertId: config.id,
        alertType: config.type
      });
    } catch (error) {
      endBusinessOperation(operationId, false, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * 更新警报（带持久化）
   */
  async updateAlert(alertId: string, updates: Partial<AlertConfig>): Promise<void> {
    // 先更新内存中的警报
    await super.updateAlert(alertId, updates);

    // 然后保存到数据库
    const updatedAlert = await super.getAlert(alertId);
    if (updatedAlert) {
      await UnifiedAlertModel.saveAlert(updatedAlert);
    }
  }

  /**
   * 删除警报（带持久化）
   */
  async removeAlert(alertId: string): Promise<void> {
    const operationId = startBusinessOperation('alert_remove', { alertId });

    try {
      // 先从内存中删除
      await super.removeAlert(alertId);

      // 然后从数据库删除
      await UnifiedAlertModel.deleteAlert(alertId);

      endBusinessOperation(operationId, true);
    } catch (error) {
      endBusinessOperation(operationId, false, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * 切换警报状态（带持久化）
   */
  async toggleAlert(alertId: string, enabled: boolean): Promise<void> {
    // 先更新内存状态
    await super.toggleAlert(alertId, enabled);

    // 然后更新数据库
    await UnifiedAlertModel.updateAlertStatus(alertId, enabled);
  }

  /**
   * 获取警报历史（从数据库）
   */
  async getAlertHistory(alertId?: string, limit: number = 100): Promise<AlertEvent[]> {
    return UnifiedAlertModel.getAlertHistory(alertId, limit);
  }

  /**
   * 清理历史记录（从数据库）
   */
  async cleanupHistory(olderThanMs: number): Promise<number> {
    // 清理内存中的历史
    const memoryCleanedCount = await super.cleanupHistory(olderThanMs);

    // 清理数据库中的历史
    const dbCleanedCount = await UnifiedAlertModel.cleanupHistory(olderThanMs);

    this.logger.info('History cleanup completed', {
      memoryCleanedCount,
      dbCleanedCount,
      totalCleaned: memoryCleanedCount + dbCleanedCount
    });

    return dbCleanedCount;
  }

  /**
   * 获取用户的警报列表
   */
  async getUserAlerts(userId: string): Promise<AlertConfig[]> {
    return UnifiedAlertModel.loadAlerts(userId);
  }

  /**
   * 保存警报事件到数据库
   */
  protected async saveAlertEvent(event: AlertEvent): Promise<void> {
    await UnifiedAlertModel.saveAlertEvent(event);
  }

  /**
   * 重写父类的handleTriggeredAlert方法以添加数据库事件保存
   */
  protected async handleTriggeredAlert(event: AlertEvent, alert: AlertConfig): Promise<void> {
    const operationId = startBusinessOperation('alert_trigger', {
      alertId: alert.id,
      alertType: alert.type,
      symbol: alert.symbol,
      eventType: event.type
    });

    try {
      // 调用父类方法处理内存操作和通知
      await super['handleTriggeredAlert'](event, alert);

      // 额外保存事件到数据库
      await this.saveAlertEvent(event);

      endBusinessOperation(operationId, true, undefined, {
        triggeredAt: event.triggeredAt,
        priority: event.priority
      });
    } catch (error) {
      endBusinessOperation(operationId, false, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * 重写统计方法，从数据库获取准确的历史数据
   */
  async getStatistics(): Promise<any> {
    try {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

      // 从数据库获取所有历史记录来计算统计信息
      const allHistory = await UnifiedAlertModel.getAlertHistory(undefined, 10000);

      const triggeredToday = allHistory.filter(
        event => event.triggeredAt.getTime() > oneDayAgo
      ).length;

      const triggeredThisWeek = allHistory.filter(
        event => event.triggeredAt.getTime() > oneWeekAgo
      ).length;

      const byType: Record<any, number> = {};
      const byPriority: Record<any, number> = {};

      for (const event of allHistory) {
        byType[event.type] = (byType[event.type] || 0) + 1;
        byPriority[event.priority] = (byPriority[event.priority] || 0) + 1;
      }

      // 获取当前警报信息（使用父类的公共方法）
      const allAlerts = await super.getAlerts();
      const totalAlerts = allAlerts.length;
      const activeAlerts = allAlerts.filter(a => a.enabled).length;

      this.logger.debug('Statistics calculated', {
        totalAlerts,
        activeAlerts,
        triggeredToday,
        triggeredThisWeek,
        totalHistoryEvents: allHistory.length
      });

      return {
        totalAlerts,
        activeAlerts,
        triggeredToday,
        triggeredThisWeek,
        byType,
        byPriority,
        avgResponseTime: 0, // TODO: 实现响应时间跟踪
        successRate: 0.95 // TODO: 实现成功率跟踪
      };
    } catch (error) {
      this.logger.error('Failed to calculate statistics from database:', error);
      // 降级到父类方法（内存统计）
      return super.getStatistics();
    }
  }
}