import { log } from './logger';
import { getDatabase } from '../database/connection';
import { businessMonitor } from './businessMonitor';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  services: {
    database: boolean;
    memory: {
      usage: number;
      limit: number;
      healthy: boolean;
    };
    uptime: number;
  };
  businessMetrics?: {
    lastHour: any;
    failurePatterns: any[];
  };
}

// 检查数据库健康状态
async function checkDatabase(): Promise<boolean> {
  try {
    const db = await getDatabase();
    await db.get('SELECT 1');
    return true;
  } catch (error) {
    log.error('数据库健康检查失败:', error);
    return false;
  }
}

// 检查内存使用情况
function checkMemory(): { usage: number; limit: number; healthy: boolean } {
  const memUsage = process.memoryUsage();
  const usageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const limitMB = 512; // 512MB限制

  return {
    usage: usageMB,
    limit: limitMB,
    healthy: usageMB < limitMB
  };
}

// 获取系统健康状态
export async function getHealthStatus(includeBusinessMetrics: boolean = false): Promise<HealthStatus> {
  const timestamp = new Date().toISOString();
  const uptime = Math.floor(process.uptime());

  const databaseHealthy = await checkDatabase();
  const memory = checkMemory();

  const allHealthy = databaseHealthy && memory.healthy;

  const status: HealthStatus = {
    status: allHealthy ? 'healthy' : 'unhealthy',
    timestamp,
    services: {
      database: databaseHealthy,
      memory,
      uptime
    }
  };

  // 添加业务指标（如果请求）
  if (includeBusinessMetrics) {
    try {
      const stats = businessMonitor.getAllStats(3600000); // 1小时内的统计
      const patterns = businessMonitor.detectFailurePatterns(3600000);

      status.businessMetrics = {
        lastHour: stats,
        failurePatterns: patterns
      };
    } catch (error) {
      log.error('Failed to get business metrics for health status:', error);
    }
  }

  return status;
}

// 定期健康检查
export function startHealthMonitoring(intervalMs: number = 60000): NodeJS.Timeout {
  const interval = setInterval(async () => {
    const health = await getHealthStatus(true); // 包含业务指标

    if (health.status === 'unhealthy') {
      log.warn('系统健康检查异常:', health);
    } else {
      log.debug('系统健康检查正常', {
        memory: health.services.memory.usage + 'MB',
        uptime: health.services.uptime + 's',
        businessSummary: health.businessMetrics?.lastHour.summary
      });
    }

    // 单独报告业务监控异常模式
    if (health.businessMetrics?.failurePatterns && health.businessMetrics.failurePatterns.length > 0) {
      log.warn('🚨 检测到业务异常模式:', {
        patterns: health.businessMetrics.failurePatterns
      });
    }
  }, intervalMs);

  log.info(`健康监控已启动，检查间隔: ${intervalMs / 1000}秒`);
  return interval;
}