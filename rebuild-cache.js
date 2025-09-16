#!/usr/bin/env node
/**
 * 重建历史高价缓存 - 完全重新收集所有数据
 */

const { historicalHighCache } = require('./dist/services/historicalHighCacheV2');

async function rebuildCache() {
  console.log('🚀 开始重建历史高价缓存...');

  try {
    // 强制重新初始化（不加载旧缓存）
    await historicalHighCache.initialize();

    console.log('✅ 历史高价缓存重建完成！');

    // 显示统计信息
    const stats = historicalHighCache.getStats();
    console.log(`📊 统计信息:`);
    console.log(`- 缓存大小: ${stats.cacheSize} 条记录`);
    console.log(`- 代币数量: ${stats.symbolCount} 个`);
    console.log(`- 时间框架: ${stats.timeframes.join(', ')}`);

  } catch (error) {
    console.error('❌ 缓存重建失败:', error);
    process.exit(1);
  } finally {
    await historicalHighCache.stop();
    process.exit(0);
  }
}

rebuildCache();