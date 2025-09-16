#!/usr/bin/env node
/**
 * 重新收集失败代币的历史数据
 * 使用方法: node recollect-symbols.js YFIUSDT TRBUSDT WAXPUSDT
 */

const { historicalHighCache } = require('./dist/services/historicalHighCacheV2');

async function main() {
  const symbols = process.argv.slice(2);

  if (symbols.length === 0) {
    console.log('使用方法: node recollect-symbols.js SYMBOL1 SYMBOL2 ...');
    console.log('例如: node recollect-symbols.js YFIUSDT TRBUSDT WAXPUSDT');
    process.exit(1);
  }

  try {
    console.log('初始化历史缓存服务...');
    await historicalHighCache.initialize();

    console.log(`开始重新收集 ${symbols.length} 个代币的数据...`);
    const result = await historicalHighCache.recollectSymbols(symbols);

    console.log(`\n收集结果:`);
    console.log(`✅ 成功: ${result.success.length} 个 - ${result.success.join(', ')}`);
    console.log(`❌ 失败: ${result.failed.length} 个 - ${result.failed.join(', ')}`);

  } catch (error) {
    console.error('收集过程中发生错误:', error);
    process.exit(1);
  } finally {
    await historicalHighCache.stop();
    process.exit(0);
  }
}

main();