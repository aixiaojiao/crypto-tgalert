export type ServiceIdentifier<T = any> = string | symbol | (new (...args: any[]) => T);

export enum ServiceLifetime {
  TRANSIENT = 'transient',   // 每次请求都创建新实例
  SINGLETON = 'singleton',   // 单例模式
  SCOPED = 'scoped'         // 作用域内单例
}

export interface ServiceDescriptor<T = any> {
  identifier: ServiceIdentifier<T>;
  implementation?: new (...args: any[]) => T;
  factory?: (container: IContainer) => T | Promise<T>;
  instance?: T;
  lifetime: ServiceLifetime;
  dependencies?: ServiceIdentifier[];
}

export interface IContainer {
  /**
   * 注册服务
   */
  register<T>(
    identifier: ServiceIdentifier<T>,
    implementation: new (...args: any[]) => T,
    lifetime?: ServiceLifetime
  ): IContainer;

  /**
   * 注册工厂函数
   */
  registerFactory<T>(
    identifier: ServiceIdentifier<T>,
    factory: (container: IContainer) => T | Promise<T>,
    lifetime?: ServiceLifetime
  ): IContainer;

  /**
   * 注册单例实例
   */
  registerInstance<T>(
    identifier: ServiceIdentifier<T>,
    instance: T
  ): IContainer;

  /**
   * 解析服务
   */
  resolve<T>(identifier: ServiceIdentifier<T>): T;

  /**
   * 异步解析服务
   */
  resolveAsync<T>(identifier: ServiceIdentifier<T>): Promise<T>;

  /**
   * 尝试解析服务（不抛出异常）
   */
  tryResolve<T>(identifier: ServiceIdentifier<T>): T | null;

  /**
   * 检查服务是否已注册
   */
  isRegistered<T>(identifier: ServiceIdentifier<T>): boolean;

  /**
   * 获取所有已注册的服务标识符
   */
  getRegisteredServices(): ServiceIdentifier[];

  /**
   * 创建作用域容器
   */
  createScope(): IContainer;

  /**
   * 获取服务描述符
   */
  getDescriptor<T>(identifier: ServiceIdentifier<T>): ServiceDescriptor<T> | null;
}