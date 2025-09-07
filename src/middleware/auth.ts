import { config } from '../config';
import { BotContext } from '../types';

/**
 * 用户认证中间件
 * 只允许授权的用户使用机器人
 */
export function authMiddleware() {
  const authorizedUserId = parseInt(config.telegram.userId, 10);
  
  return async (ctx: BotContext, next: () => Promise<void>) => {
    // 检查用户是否存在
    if (!ctx.from) {
      console.log('❌ No user information in request');
      await ctx.reply('❌ 无法识别用户信息');
      return;
    }

    const userId = ctx.from.id;
    
    // 记录访问尝试
    console.log(`👤 User ${userId} (${ctx.from.username || ctx.from.first_name}) attempting to access bot`);
    
    // 验证用户授权
    if (userId !== authorizedUserId) {
      console.log(`🚫 Unauthorized access attempt from user ${userId}`);
      await ctx.reply(`❌ 未授权访问\n你的用户ID: ${userId}\n如需访问，请联系管理员`);
      return;
    }

    // 用户已授权，继续处理
    console.log(`✅ Authorized user ${userId} accessing bot`);
    await next();
  };
}

/**
 * 检查用户是否已授权
 */
export function isAuthorizedUser(userId: number): boolean {
  const authorizedUserId = parseInt(config.telegram.userId, 10);
  return userId === authorizedUserId;
}

/**
 * 获取授权用户ID
 */
export function getAuthorizedUserId(): number {
  return parseInt(config.telegram.userId, 10);
}