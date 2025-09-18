/**
 * 技术指标模块主入口
 * Technical Indicators Module Main Entry
 */

// 核心类型和接口
export * from './types';

// 基础类和工具
export * from './base';
export { MathUtils } from './utils/MathUtils';

// 核心服务
export * from './services';

// 模块版本信息
export const INDICATORS_VERSION = '1.0.0';