#!/usr/bin/env node
/**
 * 创建生产级准确历史缓存
 */

const { binanceClient } = require('./dist/services/binance');
const { filterHistoricalDataPairs } = require('./dist/config/tokenLists');
const fs = require('fs').promises;
const path = require('path');

// 时间框架配置
const timeframeConfigs = {
  '1w': { interval: '1h', windowMs: 7 * 24 * 60 * 60 * 1000, displayName: '1周' },
  '1m': { interval: '1d', windowMs: 30 * 24 * 60 * 60 * 1000, displayName: '1个月' },
  '6m': { interval: '1d', windowMs: 180 * 24 * 60 * 60 * 1000, displayName: '6个月' },
  '1y': { interval: '1d', windowMs: 365 * 24 * 60 * 60 * 1000, displayName: '1年' },
  'all': { interval: '1d', windowMs: 0, displayName: '全量历史' }
};

async function createProductionCache() {
  console.log('🚀 开始创建生产级历史缓存...\n');

  try {
    // 1. 获取所有期货交易对
    console.log('📊 获取期货交易对列表...');
    const exchangeInfo = await binanceClient.getFuturesExchangeInfo();
    const allSymbols = exchangeInfo.symbols
      .filter(symbol =>
        symbol.status === 'TRADING' &&
        symbol.contractType === 'PERPETUAL' &&
        symbol.quoteAsset === 'USDT'
      )
      .map(symbol => symbol.symbol);

    // 2. 过滤掉黑名单代币
    const filteredSymbols = filterHistoricalDataPairs(allSymbols);
    console.log(`📈 过滤后代币: ${allSymbols.length} -> ${filteredSymbols.length}\n`);

    // 3. 准备缓存数据结构
    const cache = new Map();
    let processed = 0;
    const failed = [];

    // 4. 批量处理
    const batchSize = 8;
    for (let i = 0; i < filteredSymbols.length; i += batchSize) {
      const batch = filteredSymbols.slice(i, i + batchSize);

      const batchPromises = batch.map(async (symbol) => {
        try {
          return await processSymbol(symbol, cache);
        } catch (error) {
          console.error(`❌ ${symbol} 处理失败: ${error.message}`);
          failed.push(symbol);
          return null;
        }
      });

      await Promise.allSettled(batchPromises);

      processed += batch.length;
      const progress = Math.round((processed / filteredSymbols.length) * 100);
      console.log(`📈 进度: ${processed}/${filteredSymbols.length} (${progress}%) - 缓存大小: ${cache.size}`);

      // 批次间延迟
      if (i + batchSize < filteredSymbols.length) {
        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    // 5. 保存缓存到文件
    console.log('\n💾 保存缓存到文件...');
    const dataDir = path.join(process.cwd(), 'data');
    await fs.mkdir(dataDir, { recursive: true });

    const cacheData = {
      version: '2.0',
      timestamp: Date.now(),
      cache: Object.fromEntries(cache.entries())
    };

    const cacheFilePath = path.join(dataDir, 'historical-high-cache.json');
    await fs.writeFile(cacheFilePath, JSON.stringify(cacheData, null, 2));

    console.log('✅ 生产级缓存创建完成！');
    console.log(`📊 总缓存条目: ${cache.size}`);
    console.log(`✅ 成功处理: ${filteredSymbols.length - failed.length} 个代币`);
    console.log(`❌ 处理失败: ${failed.length} 个代币`);

    if (failed.length > 0) {
      console.log(`失败代币: ${failed.slice(0, 10).join(', ')}`);
    }

  } catch (error) {
    console.error('❌ 缓存创建失败:', error);
    throw error;
  }
}

async function processSymbol(symbol, cache) {
  // 获取当前价格
  const currentPrice = await binanceClient.getFuturesPrice(symbol);

  // 处理所有时间框架
  for (const [timeframe, config] of Object.entries(timeframeConfigs)) {
    const now = Date.now();
    let startTime;

    if (timeframe === 'all') {
      startTime = new Date('2019-09-01').getTime();
    } else {
      startTime = now - config.windowMs;
    }

    // 获取K线数据
    const klines = await getKlineData(symbol, config.interval, startTime, now);

    if (klines.length === 0) {
      continue;
    }

    // 计算历史最高价
    let highPrice = currentPrice;
    let highTimestamp = now;

    for (const kline of klines) {
      const klineHigh = parseFloat(kline.high);
      if (klineHigh > highPrice) {
        highPrice = klineHigh;
        highTimestamp = kline.closeTime;
      }
    }

    const distancePercent = ((currentPrice - highPrice) / highPrice) * 100;
    const neededGainPercent = distancePercent >= 0 ? 0 : Math.abs(distancePercent);

    // 存入缓存
    const cacheKey = `${symbol}:${timeframe}`;
    cache.set(cacheKey, {
      symbol,
      timeframe,
      currentPrice,
      highPrice,
      highTimestamp,
      distancePercent,
      neededGainPercent,
      lastUpdated: now
    });

    // 小延迟
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log(`✅ ${symbol} 处理完成`);
}

async function getKlineData(symbol, interval, startTime, endTime) {
  const allKlines = [];
  const batchSize = 1000;
  let currentStartTime = startTime;

  while (currentStartTime < endTime) {
    const rawKlines = await binanceClient.getFuturesKlines({
      symbol,
      interval: interval,
      startTime: currentStartTime,
      endTime,
      limit: batchSize
    });

    if (rawKlines.length === 0) {
      break;
    }

    const mappedKlines = rawKlines.map(kline => ({
      openTime: kline.openTime,
      openPrice: kline.open,
      highPrice: kline.high,
      lowPrice: kline.low,
      closePrice: kline.close,
      volume: kline.volume,
      closeTime: kline.closeTime
    }));

    allKlines.push(...mappedKlines);

    if (rawKlines.length < batchSize) {
      break;
    }

    currentStartTime = rawKlines[rawKlines.length - 1].closeTime + 1;

    // API限制延迟
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return allKlines;
}

createProductionCache();