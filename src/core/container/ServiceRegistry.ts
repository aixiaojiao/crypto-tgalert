import { Container } from './Container';
import { IContainer, ServiceLifetime } from './IContainer';
import { getDependencies, getInjectableMetadata, isInjectable, SERVICE_IDENTIFIERS } from './decorators';
import { getDataManager } from '@/data/DataManager';
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

    // 数据管理器 - 单例
    this.container.registerFactory(
      SERVICE_IDENTIFIERS.DATA_MANAGER,
      () => getDataManager(),
      ServiceLifetime.SINGLETON
    );

    // Binance客户端 - 单例
    this.container.registerInstance(SERVICE_IDENTIFIERS.BINANCE_CLIENT, binanceClient);

    log.info('Core services registered', {
      services: this.container.getRegisteredServices().map(s => s.toString())
    });
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