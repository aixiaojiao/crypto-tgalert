import { Application, ApplicationConfig, ILifecycleAware } from './Application';
import { ServiceRegistry, getServiceRegistry, SERVICE_IDENTIFIERS } from './container';
import { log } from '../utils/logger';

// 现在不再需要直接导入单例服务，全部通过DI容器管理

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

      // 1. 验证服务注册（所有13个核心服务已在ServiceRegistry中注册）
      this.validateServiceRegistration();

      // 2. 注册额外的业务服务（非核心服务）
      this.registerAdditionalServices();

      // 3. 配置服务依赖
      this.configureServiceDependencies();

      // 4. 预热关键服务
      await this.preheatCriticalServices();

      // 5. 启动应用
      await this.application.initialize();
      await this.application.start();

      return this.application;

    } catch (error) {
      log.error('❌ Failed to bootstrap application', error);
      throw error;
    }
  }

  /**
   * 验证服务注册 - 确保所有13个核心服务都已注册
   */
  private validateServiceRegistration(): void {
    const requiredServices = [
      // Foundation Layer
      SERVICE_IDENTIFIERS.BINANCE_RATE_LIMITER,
      SERVICE_IDENTIFIERS.PRICE_CACHE,
      SERVICE_IDENTIFIERS.MARKET_DATA_CACHE,
      SERVICE_IDENTIFIERS.OI_CACHE,
      SERVICE_IDENTIFIERS.FUNDING_CACHE,
      SERVICE_IDENTIFIERS.VOLUME_CLASSIFIER,
      SERVICE_IDENTIFIERS.DATABASE_CONNECTION,

      // Data Layer
      SERVICE_IDENTIFIERS.BINANCE_CLIENT,
      SERVICE_IDENTIFIERS.TIERED_DATA_MANAGER,
      SERVICE_IDENTIFIERS.BINANCE_WEBSOCKET_CLIENT,

      // Business Layer
      SERVICE_IDENTIFIERS.REALTIME_MARKET_CACHE,
      SERVICE_IDENTIFIERS.HISTORICAL_HIGH_CACHE,
      SERVICE_IDENTIFIERS.RANKING_ANALYZER,

      // Application Layer
      SERVICE_IDENTIFIERS.PRICE_MONITOR_SERVICE,
      SERVICE_IDENTIFIERS.REALTIME_ALERT_SERVICE
    ];

    const container = this.serviceRegistry.getContainer();
    const missingServices: string[] = [];

    requiredServices.forEach(serviceId => {
      if (!container.isRegistered(serviceId)) {
        missingServices.push(serviceId.toString());
      }
    });

    if (missingServices.length > 0) {
      throw new Error(`Missing required services: ${missingServices.join(', ')}`);
    }

    log.info('✅ All 13 core services are registered', {
      coreServices: requiredServices.length
    });
  }

  /**
   * 预热关键服务 - 确保核心服务正确初始化
   */
  private async preheatCriticalServices(): Promise<void> {
    log.info('🔥 Preheating critical services');

    try {
      // 预热数据库连接
      const dbInit = this.serviceRegistry.resolve(SERVICE_IDENTIFIERS.DATABASE_CONNECTION);
      if (typeof dbInit === 'function') {
        await dbInit();
        log.info('✅ Database connection initialized');
      }

      // 预热Binance客户端（测试连接）
      const binanceClient = this.serviceRegistry.resolve(SERVICE_IDENTIFIERS.BINANCE_CLIENT) as any;
      try {
        // 简单测试连接
        if (binanceClient && typeof binanceClient.getPrice === 'function') {
          await binanceClient.getPrice('BTCUSDT');
          log.info('✅ Binance client connection verified');
        }
      } catch (error) {
        log.warn('⚠️ Binance connection test failed, but continuing', { error: error instanceof Error ? error.message : String(error) });
      }

      // 历史高点缓存 v3：非阻塞启动，冷刷新在后台
      const historicalHighSvc = this.serviceRegistry.resolve(SERVICE_IDENTIFIERS.HISTORICAL_HIGH_CACHE) as any;
      if (historicalHighSvc && typeof historicalHighSvc.start === 'function') {
        await historicalHighSvc.start();
        log.info('✅ Historical high cache service (v3) started');
      }

    } catch (error) {
      log.error('❌ Failed to preheat critical services', error);
      throw error;
    }
  }

  /**
   * 注册额外的业务服务（非13个核心服务）
   */
  private registerAdditionalServices(): void {
    log.debug('📝 Registering additional services');

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

    this.serviceRegistry.registerFactory('HIGH_COMMAND_HANDLER', (container) => {
      const { HighCommandHandler } = require('../services/telegram');
      const messageFormatter = container.resolve('MESSAGE_FORMATTER');
      const logger = container.resolve(SERVICE_IDENTIFIERS.LOGGER);
      const highService = container.resolve(SERVICE_IDENTIFIERS.HISTORICAL_HIGH_CACHE);
      return new HighCommandHandler(messageFormatter, logger, highService);
    });

    log.debug('✅ Additional services registered');
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
 * 服务启动顺序管理器 - 按依赖层级管理13个核心服务启动
 */
export class ServiceStartupOrchestrator {
  private startupOrder: Array<{
    name: string;
    serviceId: string;
    dependencies: string[];
    critical: boolean; // 是否为关键服务，失败时应停止启动
  }> = [
    // === FOUNDATION LAYER (基础层 - 无依赖) ===
    {
      name: 'Database Connection',
      serviceId: SERVICE_IDENTIFIERS.DATABASE_CONNECTION.toString(),
      dependencies: [],
      critical: true
    },
    {
      name: 'Binance Rate Limiter',
      serviceId: SERVICE_IDENTIFIERS.BINANCE_RATE_LIMITER.toString(),
      dependencies: [],
      critical: true
    },
    {
      name: 'Price Cache',
      serviceId: SERVICE_IDENTIFIERS.PRICE_CACHE.toString(),
      dependencies: [],
      critical: false
    },
    {
      name: 'Market Data Cache',
      serviceId: SERVICE_IDENTIFIERS.MARKET_DATA_CACHE.toString(),
      dependencies: [],
      critical: false
    },
    {
      name: 'OI Cache',
      serviceId: SERVICE_IDENTIFIERS.OI_CACHE.toString(),
      dependencies: [],
      critical: false
    },
    {
      name: 'Funding Cache',
      serviceId: SERVICE_IDENTIFIERS.FUNDING_CACHE.toString(),
      dependencies: [],
      critical: false
    },
    {
      name: 'Volume Classifier',
      serviceId: SERVICE_IDENTIFIERS.VOLUME_CLASSIFIER.toString(),
      dependencies: [],
      critical: false
    },

    // === DATA LAYER (数据层) ===
    {
      name: 'Data Manager',
      serviceId: SERVICE_IDENTIFIERS.DATA_MANAGER.toString(),
      dependencies: [SERVICE_IDENTIFIERS.DATABASE_CONNECTION.toString()],
      critical: true
    },
    {
      name: 'Binance Client',
      serviceId: SERVICE_IDENTIFIERS.BINANCE_CLIENT.toString(),
      dependencies: [
        SERVICE_IDENTIFIERS.BINANCE_RATE_LIMITER.toString(),
        SERVICE_IDENTIFIERS.MARKET_DATA_CACHE.toString(),
        SERVICE_IDENTIFIERS.OI_CACHE.toString()
      ],
      critical: true
    },
    {
      name: 'Tiered Data Manager',
      serviceId: SERVICE_IDENTIFIERS.TIERED_DATA_MANAGER.toString(),
      dependencies: [
        SERVICE_IDENTIFIERS.BINANCE_CLIENT.toString(),
        SERVICE_IDENTIFIERS.VOLUME_CLASSIFIER.toString()
      ],
      critical: true
    },
    {
      name: 'Binance WebSocket Client',
      serviceId: SERVICE_IDENTIFIERS.BINANCE_WEBSOCKET_CLIENT.toString(),
      dependencies: [],
      critical: true
    },

    // === BUSINESS LAYER (业务层 - 有依赖) ===
    {
      name: 'Realtime Market Cache',
      serviceId: SERVICE_IDENTIFIERS.REALTIME_MARKET_CACHE.toString(),
      dependencies: [SERVICE_IDENTIFIERS.BINANCE_WEBSOCKET_CLIENT.toString()],
      critical: false
    },
    {
      name: 'Historical High Cache',
      serviceId: SERVICE_IDENTIFIERS.HISTORICAL_HIGH_CACHE.toString(),
      dependencies: [SERVICE_IDENTIFIERS.BINANCE_CLIENT.toString()],
      critical: false
    },
    {
      name: 'Ranking Analyzer',
      serviceId: SERVICE_IDENTIFIERS.RANKING_ANALYZER.toString(),
      dependencies: [SERVICE_IDENTIFIERS.BINANCE_CLIENT.toString()],
      critical: false
    },

    // === APPLICATION LAYER (应用层 - 复合依赖) ===
    {
      name: 'Realtime Alert Service',
      serviceId: SERVICE_IDENTIFIERS.REALTIME_ALERT_SERVICE.toString(),
      dependencies: [
        SERVICE_IDENTIFIERS.REALTIME_MARKET_CACHE.toString(),
        'TELEGRAM_BOT_SERVICE'
      ],
      critical: true
    },
    {
      name: 'Price Monitor Service',
      serviceId: SERVICE_IDENTIFIERS.PRICE_MONITOR_SERVICE.toString(),
      dependencies: [
        SERVICE_IDENTIFIERS.BINANCE_CLIENT.toString(),
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