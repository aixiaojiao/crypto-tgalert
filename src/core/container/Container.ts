import {
  IContainer,
  ServiceIdentifier,
  ServiceDescriptor,
  ServiceLifetime
} from './IContainer';
import { log } from '../../utils/logger';

export class Container implements IContainer {
  private services = new Map<ServiceIdentifier, ServiceDescriptor>();
  private singletonInstances = new Map<ServiceIdentifier, any>();
  private scopedInstances = new Map<ServiceIdentifier, any>();
  private resolutionStack: ServiceIdentifier[] = [];
  private parentContainer: Container | undefined;

  constructor(parentContainer?: Container) {
    this.parentContainer = parentContainer;
  }

  register<T>(
    identifier: ServiceIdentifier<T>,
    implementation: new (...args: any[]) => T,
    lifetime: ServiceLifetime = ServiceLifetime.TRANSIENT
  ): IContainer {
    const descriptor: ServiceDescriptor<T> = {
      identifier,
      implementation,
      lifetime,
      dependencies: this.extractDependencies(implementation)
    };

    this.services.set(identifier, descriptor);

    log.debug('Service registered', {
      identifier: this.getIdentifierName(identifier),
      lifetime,
      dependencies: descriptor.dependencies?.map(d => this.getIdentifierName(d))
    });

    return this;
  }

  registerFactory<T>(
    identifier: ServiceIdentifier<T>,
    factory: (container: IContainer) => T | Promise<T>,
    lifetime: ServiceLifetime = ServiceLifetime.TRANSIENT
  ): IContainer {
    const descriptor: ServiceDescriptor<T> = {
      identifier,
      factory,
      lifetime
    };

    this.services.set(identifier, descriptor);

    log.debug('Factory registered', {
      identifier: this.getIdentifierName(identifier),
      lifetime
    });

    return this;
  }

  registerInstance<T>(identifier: ServiceIdentifier<T>, instance: T): IContainer {
    const descriptor: ServiceDescriptor<T> = {
      identifier,
      instance,
      lifetime: ServiceLifetime.SINGLETON
    };

    this.services.set(identifier, descriptor);
    this.singletonInstances.set(identifier, instance);

    log.debug('Instance registered', {
      identifier: this.getIdentifierName(identifier)
    });

    return this;
  }

  resolve<T>(identifier: ServiceIdentifier<T>): T {
    try {
      return this.internalResolve(identifier, false) as T;
    } catch (error) {
      log.error('Service resolution failed', {
        identifier: this.getIdentifierName(identifier),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async resolveAsync<T>(identifier: ServiceIdentifier<T>): Promise<T> {
    try {
      return await this.internalResolve(identifier, true) as T;
    } catch (error) {
      log.error('Async service resolution failed', {
        identifier: this.getIdentifierName(identifier),
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  tryResolve<T>(identifier: ServiceIdentifier<T>): T | null {
    try {
      return this.resolve(identifier);
    } catch {
      return null;
    }
  }

  isRegistered<T>(identifier: ServiceIdentifier<T>): boolean {
    if (this.services.has(identifier)) {
      return true;
    }

    if (this.parentContainer) {
      return this.parentContainer.isRegistered(identifier);
    }

    return false;
  }

  getRegisteredServices(): ServiceIdentifier[] {
    const services = Array.from(this.services.keys());

    if (this.parentContainer) {
      const parentServices = this.parentContainer.getRegisteredServices();
      return [...services, ...parentServices.filter(s => !services.includes(s))];
    }

    return services;
  }

  createScope(): IContainer {
    return new Container(this);
  }

  getDescriptor<T>(identifier: ServiceIdentifier<T>): ServiceDescriptor<T> | null {
    const descriptor = this.services.get(identifier);
    if (descriptor) {
      return descriptor as ServiceDescriptor<T>;
    }

    if (this.parentContainer) {
      return this.parentContainer.getDescriptor(identifier);
    }

    return null;
  }

  // Private methods

  private internalResolve<T>(identifier: ServiceIdentifier<T>, async: boolean = false): T | Promise<T> {
    // 检查循环依赖
    if (this.resolutionStack.includes(identifier)) {
      throw new Error(`Circular dependency detected: ${this.resolutionStack.map(s => this.getIdentifierName(s)).join(' -> ')} -> ${this.getIdentifierName(identifier)}`);
    }

    this.resolutionStack.push(identifier);

    try {
      const descriptor = this.getDescriptor(identifier);
      if (!descriptor) {
        throw new Error(`Service not registered: ${this.getIdentifierName(identifier)}`);
      }

      // 根据生命周期返回实例
      switch (descriptor.lifetime) {
        case ServiceLifetime.SINGLETON:
          return this.resolveSingleton(descriptor, async);

        case ServiceLifetime.SCOPED:
          return this.resolveScoped(descriptor, async);

        case ServiceLifetime.TRANSIENT:
        default:
          return this.createInstance(descriptor, async);
      }
    } finally {
      this.resolutionStack.pop();
    }
  }

  private resolveSingleton<T>(descriptor: ServiceDescriptor<T>, async: boolean): T | Promise<T> {
    // 单例实例存储在根容器中
    const rootContainer = this.getRootContainer();

    if (rootContainer.singletonInstances.has(descriptor.identifier)) {
      return rootContainer.singletonInstances.get(descriptor.identifier);
    }

    const instance = this.createInstance(descriptor, async);

    if (async && instance instanceof Promise) {
      return instance.then(resolvedInstance => {
        rootContainer.singletonInstances.set(descriptor.identifier, resolvedInstance);
        return resolvedInstance;
      });
    } else {
      rootContainer.singletonInstances.set(descriptor.identifier, instance);
      return instance;
    }
  }

  private resolveScoped<T>(descriptor: ServiceDescriptor<T>, async: boolean): T | Promise<T> {
    if (this.scopedInstances.has(descriptor.identifier)) {
      return this.scopedInstances.get(descriptor.identifier);
    }

    const instance = this.createInstance(descriptor, async);

    if (async && instance instanceof Promise) {
      return instance.then(resolvedInstance => {
        this.scopedInstances.set(descriptor.identifier, resolvedInstance);
        return resolvedInstance;
      });
    } else {
      this.scopedInstances.set(descriptor.identifier, instance);
      return instance;
    }
  }

  private createInstance<T>(descriptor: ServiceDescriptor<T>, async: boolean): T | Promise<T> {
    // 如果已经有实例，直接返回
    if (descriptor.instance) {
      return descriptor.instance;
    }

    // 如果有工厂函数，使用工厂创建
    if (descriptor.factory) {
      const result = descriptor.factory(this);

      if (async && result instanceof Promise) {
        return result;
      } else if (!async && result instanceof Promise) {
        throw new Error(`Factory for ${this.getIdentifierName(descriptor.identifier)} returns Promise but sync resolution was requested`);
      }

      return result as T;
    }

    // 使用构造函数创建
    if (descriptor.implementation) {
      const dependencies = this.resolveDependencies(descriptor.dependencies || [], async);

      if (async && dependencies instanceof Promise) {
        return dependencies.then(deps => new descriptor.implementation!(...deps));
      } else {
        return new descriptor.implementation(...(dependencies as any[]));
      }
    }

    throw new Error(`Unable to create instance for ${this.getIdentifierName(descriptor.identifier)}`);
  }

  private resolveDependencies(dependencies: ServiceIdentifier[], async: boolean): any[] | Promise<any[]> {
    if (dependencies.length === 0) {
      return [];
    }

    if (async) {
      const promises = dependencies.map(dep => this.resolveAsync(dep));
      return Promise.all(promises);
    } else {
      return dependencies.map(dep => this.resolve(dep));
    }
  }

  private extractDependencies(_implementation: new (...args: any[]) => any): ServiceIdentifier[] {
    // 这里可以通过元数据装饰器提取依赖
    // 目前返回空数组，需要手动指定依赖或使用装饰器
    return [];
  }

  private getIdentifierName(identifier: ServiceIdentifier): string {
    if (typeof identifier === 'string') {
      return identifier;
    }

    if (typeof identifier === 'symbol') {
      return identifier.toString();
    }

    if (typeof identifier === 'function') {
      return identifier.name || '[Anonymous Class]';
    }

    return '[Unknown]';
  }

  private getRootContainer(): Container {
    let current: Container = this;
    while (current.parentContainer) {
      current = current.parentContainer;
    }
    return current;
  }

  // Debug methods

  getDependencyTree(): any {
    const tree: any = {};

    for (const [identifier, descriptor] of this.services) {
      const name = this.getIdentifierName(identifier);
      tree[name] = {
        lifetime: descriptor.lifetime,
        dependencies: descriptor.dependencies?.map(d => this.getIdentifierName(d)) || [],
        hasInstance: this.singletonInstances.has(identifier) || this.scopedInstances.has(identifier)
      };
    }

    return tree;
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [identifier, descriptor] of this.services) {
      if (!descriptor.implementation && !descriptor.factory && !descriptor.instance) {
        errors.push(`Service ${this.getIdentifierName(identifier)} has no implementation, factory, or instance`);
      }

      if (descriptor.dependencies) {
        for (const dep of descriptor.dependencies) {
          if (!this.isRegistered(dep)) {
            errors.push(`Service ${this.getIdentifierName(identifier)} depends on unregistered service ${this.getIdentifierName(dep)}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}