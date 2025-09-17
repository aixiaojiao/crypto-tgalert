import { Application, ApplicationConfig, ILifecycleAware } from './Application';
import { ServiceRegistry, getServiceRegistry, SERVICE_IDENTIFIERS } from './container';
import { log } from '../utils/logger';

// 导入现有服务以便注册
import { triggerAlertService } from '../services/triggerAlerts';
import { historicalHighCache } from '../services/historicalHighCacheV2';
import { realtimeMarketCache } from '../services/realtimeMarketCache';

export class ApplicationBootstrap {
  private application: Application;
  private serviceRegistry: ServiceRegistry;

  constructor(config?: Partial<ApplicationConfig>) {
    this.application = new Application(config);
    this.serviceRegistry = getServiceRegistry();
  }

  /**
   * 配置和启动应用
   */
  async bootstrap(): Promise<Application> {
    try {
      log.info('🔧 Configuring application services');

      // 1. 注册业务服务
      this.registerBusinessServices();

      // 2. 配置服务依赖
      this.configureServiceDependencies();

      // 3. 启动应用
      await this.application.initialize();
      await this.application.start();

      return this.application;

    } catch (error) {
      log.error('❌ Failed to bootstrap application', error);
      throw error;
    }
  }

  /**
   * 注册业务服务
   */
  private registerBusinessServices(): void {
    log.debug('📝 Registering business services');

    // Batch 1: 注册基础层DI服务
    this.registerFoundationServices();

    // Batch 2: 注册核心API服务
    this.registerCoreApiServices();

    // 注册触发警报服务 (保持向后兼容)
    this.serviceRegistry.registerInstance('TRIGGER_ALERT_SERVICE', triggerAlertService);

    // 注册历史高价缓存服务
    this.serviceRegistry.registerInstance('HISTORICAL_HIGH_CACHE', historicalHighCache);

    // 注册实时市场数据缓存服务
    this.serviceRegistry.registerInstance('REALTIME_MARKET_CACHE', realtimeMarketCache);

    // 注册新的统一报警服务
    this.serviceRegistry.registerFactory('UNIFIED_ALERT_SERVICE', (container) => {
      const { UnifiedAlertService } = require('../services/alerts');
      const logger = container.resolve(SERVICE_IDENTIFIERS.LOGGER);
      const notificationService = container.resolve('NOTIFICATION_SERVICE');
      return new UnifiedAlertService(logger, notificationService);
    });

    // 注册通知服务
    this.serviceRegistry.registerFactory('NOTIFICATION_SERVICE', (container) => {
      const { NotificationService } = require('../services/alerts');
      const logger = container.resolve(SERVICE_IDENTIFIERS.LOGGER);
      return new NotificationService(logger);
    });

    // 注册消息格式化服务
    this.serviceRegistry.registerFactory('MESSAGE_FORMATTER', (_container) => {
      const { MessageFormatter } = require('../services/telegram');
      return new MessageFormatter();
    });

    // 注册命令注册器
    this.serviceRegistry.registerFactory('COMMAND_REGISTRY', (container) => {
      const { CommandRegistry } = require('../services/telegram');
      const logger = container.resolve(SERVICE_IDENTIFIERS.LOGGER);
      return new CommandRegistry(logger);
    });

    // 注册重构后的Telegram服务
    this.serviceRegistry.registerFactory('TELEGRAM_SERVICE', (container) => {
      const { TelegramService } = require('../services/telegram');
      const logger = container.resolve(SERVICE_IDENTIFIERS.LOGGER);
      const commandRegistry = container.resolve('COMMAND_REGISTRY');
      const messageFormatter = container.resolve('MESSAGE_FORMATTER');
      return new TelegramService(logger, commandRegistry, messageFormatter);
    });

    // 注册命令处理器
    this.serviceRegistry.registerFactory('PRICE_COMMAND_HANDLER', (container) => {
      const { PriceCommandHandler } = require('../services/telegram');
      const messageFormatter = container.resolve('MESSAGE_FORMATTER');
      const logger = container.resolve(SERVICE_IDENTIFIERS.LOGGER);
      const binanceClient = container.resolve(SERVICE_IDENTIFIERS.BINANCE_CLIENT);
      return new PriceCommandHandler(messageFormatter, logger, binanceClient);
    });

    // 注册价格监控服务工厂 (更新以使用新服务)
    this.serviceRegistry.registerFactory('PRICE_MONITOR_SERVICE', (container) => {
      // 懒加载以避免循环依赖
      const { PriceMonitorService } = require('../services/priceMonitor');
      const binanceClient = container.resolve(SERVICE_IDENTIFIERS.BINANCE_CLIENT);
      const unifiedAlertService = container.resolve('UNIFIED_ALERT_SERVICE');
      const telegramService = container.resolve('TELEGRAM_SERVICE');

      return new PriceMonitorService(
        binanceClient,
        unifiedAlertService,
        telegramService
      );
    });

    log.debug('✅ Business services registered');
  }

  /**
   * 注册基础层服务 (Batch 1 DI Migration)
   */
  private registerFoundationServices(): void {
    log.debug('📝 Registering foundation services (Batch 1)');

    // 注册速率限制器
    this.serviceRegistry.registerFactory('BINANCE_RATE_LIMITER', () => {
      const { BinanceRateLimiter } = require('../utils/ratelimit');
      return new BinanceRateLimiter();
    });

    // 注册缓存服务
    this.serviceRegistry.registerFactory('PRICE_CACHE_SERVICE', () => {
      const { PriceCacheService } = require('../utils/cache');
      return new PriceCacheService();
    });

    this.serviceRegistry.registerFactory('MARKET_DATA_CACHE_SERVICE', () => {
      const { MarketDataCacheService } = require('../utils/cache');
      return new MarketDataCacheService();
    });

    this.serviceRegistry.registerFactory('OI_CACHE_SERVICE', () => {
      const { OICacheService } = require('../utils/cache');
      return new OICacheService();
    });

    this.serviceRegistry.registerFactory('FUNDING_CACHE_SERVICE', () => {
      const { FundingCacheService } = require('../utils/cache');
      return new FundingCacheService();
    });

    log.debug('✅ Foundation services registered (Batch 1)');
  }

  /**
   * 注册核心API服务 (Batch 2 DI Migration)
   */
  private registerCoreApiServices(): void {
    log.debug('📝 Registering core API services (Batch 2)');

    // 注册BinanceClient
    this.serviceRegistry.registerFactory('BINANCE_CLIENT_SERVICE', (container) => {
      const { BinanceClient } = require('../services/binance');
      const rateLimiter = container.resolve('BINANCE_RATE_LIMITER');
      const oiCacheService = container.resolve('OI_CACHE_SERVICE');
      const marketDataCacheService = container.resolve('MARKET_DATA_CACHE_SERVICE');

      return new BinanceClient(rateLimiter, oiCacheService, marketDataCacheService);
    });

    log.debug('✅ Core API services registered (Batch 2)');
  }

  /**
   * 配置服务依赖关系
   */
  private configureServiceDependencies(): void {
    log.debug('⚙️ Configuring service dependencies');

    // 这里可以配置服务之间的依赖关系
    // 例如：价格监控服务需要Telegram Bot服务

    log.debug('✅ Service dependencies configured');
  }

  /**
   * 创建生产环境的应用启动器
   */
  static createProduction(): ApplicationBootstrap {
    return new ApplicationBootstrap({
      environment: 'production',
      enableHealthCheck: true,
      enableMetrics: true,
      gracefulShutdownTimeout: 30000
    });
  }

  /**
   * 创建开发环境的应用启动器
   */
  static createDevelopment(): ApplicationBootstrap {
    return new ApplicationBootstrap({
      environment: 'development',
      enableHealthCheck: true,
      enableMetrics: false,
      gracefulShutdownTimeout: 10000
    });
  }

  /**
   * 创建测试环境的应用启动器
   */
  static createTest(): ApplicationBootstrap {
    return new ApplicationBootstrap({
      environment: 'test',
      enableHealthCheck: false,
      enableMetrics: false,
      gracefulShutdownTimeout: 5000
    });
  }
}

/**
 * 业务服务适配器 - 将现有服务适配为生命周期感知服务
 */
export class BusinessServiceAdapter implements ILifecycleAware {
  constructor(
    private serviceName: string,
    private service: any,
    private initMethod?: string,
    private startMethod?: string,
    private stopMethod?: string,
    private destroyMethod?: string
  ) {}

  async initialize(): Promise<void> {
    if (this.initMethod && typeof this.service[this.initMethod] === 'function') {
      log.debug(`Initializing ${this.serviceName}`);
      await this.service[this.initMethod]();
    }
  }

  async start(): Promise<void> {
    if (this.startMethod && typeof this.service[this.startMethod] === 'function') {
      log.debug(`Starting ${this.serviceName}`);
      await this.service[this.startMethod]();
    }
  }

  async stop(): Promise<void> {
    if (this.stopMethod && typeof this.service[this.stopMethod] === 'function') {
      log.debug(`Stopping ${this.serviceName}`);
      await this.service[this.stopMethod]();
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyMethod && typeof this.service[this.destroyMethod] === 'function') {
      log.debug(`Destroying ${this.serviceName}`);
      await this.service[this.destroyMethod]();
    }
  }
}

/**
 * 服务启动顺序管理器
 */
export class ServiceStartupOrchestrator {
  private startupOrder: Array<{
    name: string;
    serviceId: string;
    dependencies: string[];
    critical: boolean; // 是否为关键服务，失败时应停止启动
  }> = [
    {
      name: 'Database',
      serviceId: 'DATABASE',
      dependencies: [],
      critical: true
    },
    {
      name: 'Data Manager',
      serviceId: SERVICE_IDENTIFIERS.DATA_MANAGER.toString(),
      dependencies: ['DATABASE'],
      critical: true
    },
    {
      name: 'Binance Client',
      serviceId: SERVICE_IDENTIFIERS.BINANCE_CLIENT.toString(),
      dependencies: [],
      critical: true
    },
    {
      name: 'Trigger Alert Service',
      serviceId: 'TRIGGER_ALERT_SERVICE',
      dependencies: ['DATABASE'],
      critical: true
    },
    {
      name: 'Historical High Cache',
      serviceId: 'HISTORICAL_HIGH_CACHE',
      dependencies: [SERVICE_IDENTIFIERS.BINANCE_CLIENT.toString()],
      critical: false
    },
    {
      name: 'Realtime Market Cache',
      serviceId: 'REALTIME_MARKET_CACHE',
      dependencies: [SERVICE_IDENTIFIERS.BINANCE_CLIENT.toString()],
      critical: false
    },
    {
      name: 'Telegram Bot',
      serviceId: 'TELEGRAM_BOT_SERVICE',
      dependencies: [],
      critical: true
    },
    {
      name: 'Price Monitor',
      serviceId: 'PRICE_MONITOR_SERVICE',
      dependencies: [
        SERVICE_IDENTIFIERS.BINANCE_CLIENT.toString(),
        'TRIGGER_ALERT_SERVICE',
        'TELEGRAM_BOT_SERVICE'
      ],
      critical: true
    }
  ];

  /**
   * 获取排序后的启动顺序
   */
  getStartupOrder(): Array<{ name: string; serviceId: string; critical: boolean }> {
    // 简单的拓扑排序实现
    const resolved: Set<string> = new Set();
    const result: Array<{ name: string; serviceId: string; critical: boolean }> = [];

    const resolve = (service: typeof this.startupOrder[0]): void => {
      if (resolved.has(service.serviceId)) {
        return;
      }

      // 先解析依赖
      for (const depId of service.dependencies) {
        const dependency = this.startupOrder.find(s => s.serviceId === depId);
        if (dependency && !resolved.has(depId)) {
          resolve(dependency);
        }
      }

      // 添加当前服务
      resolved.add(service.serviceId);
      result.push({
        name: service.name,
        serviceId: service.serviceId,
        critical: service.critical
      });
    };

    // 解析所有服务
    for (const service of this.startupOrder) {
      resolve(service);
    }

    return result;
  }

  /**
   * 验证依赖关系是否有循环
   */
  validateDependencies(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 检查循环依赖（简单实现）
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (serviceId: string, path: string[]): void => {
      if (visiting.has(serviceId)) {
        errors.push(`Circular dependency detected: ${path.join(' -> ')} -> ${serviceId}`);
        return;
      }

      if (visited.has(serviceId)) {
        return;
      }

      const service = this.startupOrder.find(s => s.serviceId === serviceId);
      if (!service) {
        errors.push(`Service not found: ${serviceId}`);
        return;
      }

      visiting.add(serviceId);

      for (const depId of service.dependencies) {
        visit(depId, [...path, serviceId]);
      }

      visiting.delete(serviceId);
      visited.add(serviceId);
    };

    for (const service of this.startupOrder) {
      visit(service.serviceId, []);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}