import { log } from './logger';

// 自定义错误类
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

// API错误类
export class APIError extends AppError {
  public readonly service: string;

  constructor(message: string, service: string, statusCode: number = 500) {
    super(message, statusCode);
    this.service = service;
    this.name = 'APIError';
  }
}

// 验证错误类
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

// 未授权错误类
export class UnauthorizedError extends AppError {
  constructor(message: string = '未授权访问') {
    super(message, 401);
    this.name = 'UnauthorizedError';
  }
}

// 错误处理中间件
export function handleError(error: Error, context?: string): void {
  const errorContext = context ? `[${context}] ` : '';

  if (error instanceof AppError && error.isOperational) {
    log.warn(`${errorContext}${error.message}`, {
      statusCode: error.statusCode,
      stack: error.stack
    });
  } else {
    log.error(`${errorContext}${error.message}`, {
      stack: error.stack,
      name: error.name
    });
  }
}

// 异步错误包装器
export function asyncErrorHandler<T extends any[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };
}

// 重试机制
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delay: number = 1000,
  backoff: number = 2
): Promise<T> {
  let attempt = 1;

  while (attempt <= maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      log.warn(`操作失败，第${attempt}次重试中... 错误: ${error instanceof Error ? error.message : String(error)}`);

      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(backoff, attempt - 1)));
      attempt++;
    }
  }

  throw new Error('重试次数已用尽');
}

// 全局未捕获异常处理
export function setupGlobalErrorHandling(): void {
  process.on('uncaughtException', (error: Error) => {
    log.error('未捕获的异常:', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any) => {
    log.error('未处理的Promise拒绝:', { reason });
  });
}