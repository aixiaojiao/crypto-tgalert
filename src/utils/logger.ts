import winston from 'winston';
import path from 'path';

// 日志级别配置
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// 日志颜色配置
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

winston.addColors(colors);

// 自定义格式
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
);

// 控制台传输
const consoleTransport = new winston.transports.Console({
  format
});

// 文件传输
const fileTransport = new winston.transports.File({
  filename: path.join('./logs', 'app.log'),
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  )
});

// 错误文件传输
const errorTransport = new winston.transports.File({
  filename: path.join('./logs', 'error.log'),
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  )
});

// 创建logger实例
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  transports: [
    consoleTransport,
    fileTransport,
    errorTransport
  ],
  exitOnError: false
});

export default logger;

// 便捷方法
export const log = {
  error: (message: string, meta?: any) => logger.error(message, meta),
  warn: (message: string, meta?: any) => logger.warn(message, meta),
  info: (message: string, meta?: any) => logger.info(message, meta),
  http: (message: string, meta?: any) => logger.http(message, meta),
  debug: (message: string, meta?: any) => logger.debug(message, meta),
};