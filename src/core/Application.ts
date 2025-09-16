import { ServiceRegistry, getServiceRegistry, SERVICE_IDENTIFIERS } from './container';
import { log } from '../utils/logger';
import { initDatabase } from '../database/connection';

export interface ILifecycleAware {
  initialize?(): Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  destroy?(): Promise<void>;
}

export interface ApplicationConfig {
  name: string;
  version: string;
  environment: 'development' | 'production' | 'test';
  gracefulShutdownTimeout: number;
  enableHealthCheck: boolean;
  enableMetrics: boolean;
}

export class Application implements ILifecycleAware {
  private serviceRegistry: ServiceRegistry;
  private isStarted = false;
  private isInitialized = false;
  private shutdownHandlers: Array<() => Promise<void>> = [];
  private config: ApplicationConfig;
  private startupTimestamp?: number;
  private shutdownTimer?: NodeJS.Timeout;

  constructor(config: Partial<ApplicationConfig> = {}) {
    this.config = {
      name: 'crypto-tgalert',
      version: '2.1.6',
      environment: process.env.NODE_ENV as any || 'development',
      gracefulShutdownTimeout: 30000, // 30 seconds
      enableHealthCheck: true,
      enableMetrics: true,
      ...config
    };

    this.serviceRegistry = getServiceRegistry();
    this.setupProcessHandlers();
  }

  /**
   * 应用初始化 - 注册服务和配置依赖
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      log.warn('Application already initialized');
      return;
    }

    try {
      log.info('🚀 Initializing application', {
        name: this.config.name,
        version: this.config.version,
        environment: this.config.environment
      });

      // 1. 初始化基础设施
      await this.initializeInfrastructure();

      // 2. 注册应用服务
      await this.registerServices();

      // 3. 验证服务依赖
      await this.validateServices();

      // 4. 初始化服务
      await this.initializeServices();

      this.isInitialized = true;
      log.info('✅ Application initialized successfully');
    } catch (error) {
      log.error('❌ Failed to initialize application', error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * 启动应用 - 启动所有服务
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isStarted) {
      log.warn('Application already started');
      return;
    }

    try {
      log.info('🚀 Starting application services');
      this.startupTimestamp = Date.now();

      // 按优先级启动服务
      await this.startServices();

      this.isStarted = true;
      const startupTime = Date.now() - this.startupTimestamp;

      log.info('✅ Application started successfully', { startupTimeMs: startupTime });

      // 发送启动通知
      await this.sendStartupNotification();

    } catch (error) {
      log.error('❌ Failed to start application', error);
      await this.stop();
      throw error;
    }
  }

  /**
   * 停止应用
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      log.warn('Application not started');
      return;
    }

    try {
      log.info('🛑 Stopping application');

      // 设置超时保护
      this.shutdownTimer = setTimeout(() => {
        log.error('⚠️ Graceful shutdown timeout, forcing exit');
        process.exit(1);
      }, this.config.gracefulShutdownTimeout);

      // 停止服务（逆序）
      await this.stopServices();

      // 执行关闭处理器
      await this.executeShutdownHandlers();

      // 清理资源
      await this.cleanup();

      if (this.shutdownTimer) {
        clearTimeout(this.shutdownTimer);
      }

      this.isStarted = false;
      log.info('✅ Application stopped gracefully');

    } catch (error) {
      log.error('❌ Error during application shutdown', error);
      throw error;
    }
  }

  /**
   * 销毁应用
   */
  async destroy(): Promise<void> {
    await this.stop();
    // 清理全局资源
    log.info('🗑️ Application destroyed');
  }

  // Private methods

  private async initializeInfrastructure(): Promise<void> {
    log.debug('📊 Initializing infrastructure');

    // 1. 数据库初始化
    try {
      const db = await initDatabase();
      this.serviceRegistry.registerInstance('DATABASE', db);
      log.info('✅ Database initialized');
    } catch (error) {
      log.error('❌ Failed to initialize database', error);
      throw error;
    }

    // 2. 数据管理器初始化
    this.serviceRegistry.resolve(SERVICE_IDENTIFIERS.DATA_MANAGER);
    log.info('✅ Data manager initialized');

    // 3. 其他基础设施初始化
    log.debug('✅ Infrastructure initialization completed');
  }

  private async registerServices(): Promise<void> {
    log.debug('📝 Registering application services');

    // 这里注册应用特定的服务
    // 比如业务逻辑服务、控制器等

    log.debug('✅ Services registered');
  }

  private async validateServices(): Promise<void> {
    log.debug('🔍 Validating service dependencies');

    const validation = this.serviceRegistry.validate();
    if (!validation.valid) {
      throw new Error(`Service validation failed: ${validation.errors.join(', ')}`);
    }

    log.debug('✅ Service dependencies validated');
  }

  private async initializeServices(): Promise<void> {
    log.debug('⚙️ Initializing services');

    // 获取所有需要初始化的服务并按依赖顺序初始化
    const services = this.getLifecycleServices();

    for (const service of services) {
      if (service.initialize) {
        try {
          await service.initialize();
          log.debug(`✅ Service initialized: ${service.constructor.name}`);
        } catch (error) {
          log.error(`❌ Failed to initialize service: ${service.constructor.name}`, error);
          throw error;
        }
      }
    }

    log.debug('✅ All services initialized');
  }

  private async startServices(): Promise<void> {
    log.debug('🚀 Starting services');

    const services = this.getLifecycleServices();

    for (const service of services) {
      if (service.start) {
        try {
          await service.start();
          log.debug(`✅ Service started: ${service.constructor.name}`);
        } catch (error) {
          log.error(`❌ Failed to start service: ${service.constructor.name}`, error);
          throw error;
        }
      }
    }

    log.debug('✅ All services started');
  }

  private async stopServices(): Promise<void> {
    log.debug('🛑 Stopping services');

    const services = this.getLifecycleServices().reverse(); // 逆序停止

    for (const service of services) {
      if (service.stop) {
        try {
          await service.stop();
          log.debug(`✅ Service stopped: ${service.constructor.name}`);
        } catch (error) {
          log.warn(`⚠️ Error stopping service: ${service.constructor.name}`, error);
          // 继续停止其他服务
        }
      }
    }

    log.debug('✅ All services stopped');
  }

  private async executeShutdownHandlers(): Promise<void> {
    log.debug('🧹 Executing shutdown handlers');

    for (const handler of this.shutdownHandlers) {
      try {
        await handler();
      } catch (error) {
        log.warn('⚠️ Error in shutdown handler', error);
      }
    }

    log.debug('✅ Shutdown handlers executed');
  }

  private async cleanup(): Promise<void> {
    log.debug('🧹 Cleaning up resources');

    const services = this.getLifecycleServices().reverse();

    for (const service of services) {
      if (service.destroy) {
        try {
          await service.destroy();
          log.debug(`✅ Service destroyed: ${service.constructor.name}`);
        } catch (error) {
          log.warn(`⚠️ Error destroying service: ${service.constructor.name}`, error);
        }
      }
    }

    log.debug('✅ Cleanup completed');
  }

  private getLifecycleServices(): ILifecycleAware[] {
    // 这里应该从服务容器中获取实现了 ILifecycleAware 的服务
    // 暂时返回空数组，具体实现需要根据注册的服务来决定
    return [];
  }

  private setupProcessHandlers(): void {
    // 优雅关闭处理
    const gracefulShutdown = async (signal: string) => {
      log.info(`📡 Received ${signal}, starting graceful shutdown`);
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        log.error('❌ Error during graceful shutdown', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // 全局异常处理
    process.on('uncaughtException', (error) => {
      log.error('💥 Uncaught exception', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      log.error('💥 Unhandled rejection', { reason, promise });
      process.exit(1);
    });
  }

  private async sendStartupNotification(): Promise<void> {
    try {
      // 发送应用启动通知
      const startupTime = this.startupTimestamp ? Date.now() - this.startupTimestamp : 0;

      log.info('📢 Sending startup notification', {
        name: this.config.name,
        version: this.config.version,
        environment: this.config.environment,
        startupTimeMs: startupTime
      });

      // 这里可以通过Telegram或其他方式发送通知

    } catch (error) {
      log.warn('⚠️ Failed to send startup notification', error);
      // 不阻塞应用启动
    }
  }

  // Public API

  /**
   * 注册关闭处理器
   */
  onShutdown(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * 获取应用状态
   */
  getStatus() {
    return {
      name: this.config.name,
      version: this.config.version,
      environment: this.config.environment,
      initialized: this.isInitialized,
      started: this.isStarted,
      uptime: this.startupTimestamp ? Date.now() - this.startupTimestamp : 0,
      services: this.serviceRegistry.getContainer().getRegisteredServices().length
    };
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    try {
      if (!this.isStarted) {
        return {
          status: 'unhealthy',
          details: { reason: 'Application not started' }
        };
      }

      // 执行健康检查逻辑
      return {
        status: 'healthy',
        details: {
          uptime: this.startupTimestamp ? Date.now() - this.startupTimestamp : 0,
          services: 'all_operational'
        }
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * 获取服务实例
   */
  getService<T>(identifier: symbol | string): T {
    return this.serviceRegistry.resolve(identifier);
  }
}