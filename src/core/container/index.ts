// Core interfaces and types
export type { IContainer, ServiceIdentifier, ServiceDescriptor } from './IContainer';
export { ServiceLifetime } from './IContainer';

// Container implementation
export { Container } from './Container';

// Service registry
export { ServiceRegistry, getServiceRegistry, resetServiceRegistry, resolve, resolveAsync } from './ServiceRegistry';

// Decorators
export {
  Injectable,
  Inject,
  Singleton,
  Scoped,
  Transient,
  getDependencies,
  getInjectableMetadata,
  isInjectable,
  SERVICE_IDENTIFIERS
} from './decorators';

export type { ServiceIdentifiers } from './decorators';