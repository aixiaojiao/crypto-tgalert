import { Container } from './Container';
import { IContainer, ServiceLifetime } from './IContainer';
import { getDependencies, getInjectableMetadata, isInjectable, SERVICE_IDENTIFIERS } from './decorators';
// import { getDataManager } from '../../data/DataManager'; // 运行时加载
import { binanceClient } from '../../services/binance';
import { log } from '../../utils/logger';
import { config } from '../../config';

export class ServiceRegistry {
  private container: Container;

  constructor() {
    this.container = new Container();
    this.registerCoreServices();
  }

  /**
   * 注册核心服务
   */
  private registerCoreServices(): void {
    // 配置服务
    this.container.registerInstance(SERVICE_IDENTIFIERS.CONFIG, config);

    // 日志服务
    this.container.registerInstance(SERVICE_IDENTIFIERS.LOGGER, log);

    // === FOUNDATION LAYER (基础层 - 无依赖) ===
    this.registerFoundationServices();

    // === DATA LAYER (数据层) ===
    this.registerDataServices();

    // === BUSINESS LAYER (业务层 - 有依赖) ===
    this.registerBusinessServices();

    // === APPLICATION LAYER (应用层 - 复合依赖) ===
    this.registerApplicationServices();

    log.info('Core services registered', {
      services: this.container.getRegisteredServices().map(s => s.toString())
    });
  }

  /**
   * 注册基础层服务 - 无外部依赖
   */
  private registerFoundationServices(): void {
    // 速率限制器
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.BINANCE_RATE_LIMITER,
      () => {
        const { binanceRateLimit } = require('../../utils/ratelimit');
        return binanceRateLimit;
      },
      ServiceLifetime.SINGLETON
    );

    // 缓存服务
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.PRICE_CACHE,
      () => {
        const { priceCache } = require('../../utils/cache');
        return priceCache;
      },
      ServiceLifetime.SINGLETON
    );

    this.container.registerFactory(
      SERVICE_IDENTIFIERS.MARKET_DATA_CACHE,
      () => {
        const { marketDataCache } = require('../../utils/cache');
        return marketDataCache;
      },
      ServiceLifetime.SINGLETON
    );

    this.container.registerFactory(
      SERVICE_IDENTIFIERS.OI_CACHE,
      () => {
        const { oiCache } = require('../../utils/cache');
        return oiCache;
      },
      ServiceLifetime.SINGLETON
    );

    this.container.registerFactory(
      SERVICE_IDENTIFIERS.FUNDING_CACHE,
      () => {
        const { fundingCache } = require('../../utils/cache');
        return fundingCache;
      },
      ServiceLifetime.SINGLETON
    );

    // 音量分类器
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.VOLUME_CLASSIFIER,
      () => {
        const { volumeClassifier } = require('../../utils/volumeClassifier');
        return volumeClassifier;
      },
      ServiceLifetime.SINGLETON
    );

    // 数据库连接
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.DATABASE_CONNECTION,
      () => {
        const { initDatabase } = require('../../database/connection');
        return initDatabase; // 返回初始化函数
      },
      ServiceLifetime.SINGLETON
    );
  }

  /**
   * 注册数据层服务
   */
  private registerDataServices(): void {
    // 数据管理器 - 单例 (运行时动态加载)
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.DATA_MANAGER,
      () => {
        try {
          // 动态加载DataManager，避免构建时依赖缓存代码
          const { getDataManager } = require('../../data/DataManager');
          return getDataManager();
        } catch (error) {
          log.warn('DataManager not available, using null instance', { error: error instanceof Error ? error.message : String(error) });
          return null;
        }
      },
      ServiceLifetime.SINGLETON
    );

    // Binance客户端 - 依赖速率限制器和缓存
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.BINANCE_CLIENT,
      (_container) => {
        // 暂时保持对现有单例的兼容性，逐步迁移
        return binanceClient;
      },
      ServiceLifetime.SINGLETON
    );

    // 分层数据管理器
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.TIERED_DATA_MANAGER,
      (_container) => {
        const { tieredDataManager } = require('../../services/tieredDataManager');
        return tieredDataManager;
      },
      ServiceLifetime.SINGLETON
    );

    // Binance WebSocket客户端
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.BINANCE_WEBSOCKET_CLIENT,
      (_container) => {
        const { binanceWebSocket } = require('../../services/binanceWebSocket');
        return binanceWebSocket;
      },
      ServiceLifetime.SINGLETON
    );
  }

  /**
   * 注册业务层服务 - 有依赖
   */
  private registerBusinessServices(): void {
    // 实时市场缓存
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.REALTIME_MARKET_CACHE,
      (_container) => {
        const { realtimeMarketCache } = require('../../services/realtimeMarketCache');
        return realtimeMarketCache;
      },
      ServiceLifetime.SINGLETON
    );

    // 历史高点缓存
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.HISTORICAL_HIGH_CACHE,
      (_container) => {
        const { historicalHighCache } = require('../../services/historicalHighCacheV2');
        return historicalHighCache;
      },
      ServiceLifetime.SINGLETON
    );

    // 排名分析器
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.RANKING_ANALYZER,
      (_container) => {
        const { rankingAnalyzer } = require('../../services/rankingAnalyzer');
        return rankingAnalyzer;
      },
      ServiceLifetime.SINGLETON
    );
  }

  /**
   * 注册应用层服务 - 复合依赖
   */
  private registerApplicationServices(): void {
    // 价格监控服务
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.PRICE_MONITOR_SERVICE,
      (_container) => {
        const { priceMonitor } = require('../../services/priceMonitor');
        return priceMonitor;
      },
      ServiceLifetime.SINGLETON
    );

    // 触发警报服务
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.TRIGGER_ALERT_SERVICE,
      (_container) => {
        const { triggerAlertService } = require('../../services/triggerAlerts');
        return triggerAlertService;
      },
      ServiceLifetime.SINGLETON
    );

    // 实时警报服务
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.REALTIME_ALERT_SERVICE,
      (_container) => {
        const { realtimeAlertService } = require('../../services/realtimeAlertService');
        return realtimeAlertService;
      },
      ServiceLifetime.SINGLETON
    );
  }

  /**
   * 自动注册标记了装饰器的类
   */
  registerClass<T>(
    constructor: (new (...args: any[]) => T),
    identifier?: symbol | string
  ): void {
    const serviceIdentifier = identifier || constructor;

    if (!isInjectable(constructor)) {
      throw new Error(`Class ${constructor.name} is not marked as @Injectable`);
    }

    const metadata = getInjectableMetadata(constructor);
    const lifetime = metadata?.lifetime || ServiceLifetime.TRANSIENT;

    // 提取依赖
    const dependencies = getDependencies(constructor);

    // 注册服务
    this.container.register(serviceIdentifier, constructor, lifetime);

    // 手动设置依赖信息
    const descriptor = this.container.getDescriptor(serviceIdentifier);
    if (descriptor) {
      descriptor.dependencies = dependencies;
    }

    log.debug('Class registered', {
      class: constructor.name,
      identifier: serviceIdentifier.toString(),
      lifetime,
      dependencies: dependencies.map(d => d.toString())
    });
  }

  /**
   * 批量注册服务类
   */
  registerClasses(constructors: Array<(new (...args: any[]) => any)>): void {
    constructors.forEach(constructor => {
      this.registerClass(constructor);
    });
  }

  /**
   * 注册服务工厂
   */
  registerFactory<T>(
    identifier: symbol | string,
    factory: (container: IContainer) => T | Promise<T>,
    lifetime: ServiceLifetime = ServiceLifetime.TRANSIENT
  ): void {
    this.container.registerFactory(identifier, factory, lifetime);
  }

  /**
   * 注册服务实例
   */
  registerInstance<T>(identifier: symbol | string, instance: T): void {
    this.container.registerInstance(identifier, instance);
  }

  /**
   * 获取容器实例
   */
  getContainer(): IContainer {
    return this.container;
  }

  /**
   * 解析服务
   */
  resolve<T>(identifier: symbol | string | (new (...args: any[]) => T)): T {
    return this.container.resolve(identifier);
  }

  /**
   * 异步解析服务
   */
  async resolveAsync<T>(identifier: symbol | string | (new (...args: any[]) => T)): Promise<T> {
    return this.container.resolveAsync(identifier);
  }

  /**
   * 验证所有服务注册
   */
  validate(): { valid: boolean; errors: string[] } {
    const result = this.container.validate();

    if (!result.valid) {
      log.error('Service registration validation failed', { errors: result.errors });
    } else {
      log.info('Service registration validation passed');
    }

    return result;
  }

  /**
   * 获取依赖树（用于调试）
   */
  getDependencyTree(): any {
    return this.container.getDependencyTree();
  }

  /**
   * 创建作用域容器
   */
  createScope(): IContainer {
    return this.container.createScope();
  }

  /**
   * 预配置常用的服务注册
   */
  static createDefault(): ServiceRegistry {
    const registry = new ServiceRegistry();

    // 这里可以添加默认的服务注册
    // registry.registerClasses([...]);

    return registry;
  }
}

// 全局服务注册表实例
let globalServiceRegistry: ServiceRegistry | null = null;

/**
 * 获取全局服务注册表
 */
export function getServiceRegistry(): ServiceRegistry {
  if (!globalServiceRegistry) {
    globalServiceRegistry = ServiceRegistry.createDefault();
  }
  return globalServiceRegistry;
}

/**
 * 重置全局服务注册表（主要用于测试）
 */
export function resetServiceRegistry(): void {
  globalServiceRegistry = null;
}

/**
 * 便捷的服务解析函数
 */
export function resolve<T>(identifier: symbol | string | (new (...args: any[]) => T)): T {
  return getServiceRegistry().resolve(identifier);
}

/**
 * 便捷的异步服务解析函数
 */
export async function resolveAsync<T>(identifier: symbol | string | (new (...args: any[]) => T)): Promise<T> {
  return getServiceRegistry().resolveAsync(identifier);
}