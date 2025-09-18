#!/usr/bin/env ts-node

/**
 * 简化版诊断工具 - 专注监控关键问题
 */

import { BinanceClient } from '../src/services/binance';
import { log } from '../src/utils/logger';

class SimpleDiagnostics {
  private binanceClient: BinanceClient;

  constructor() {
    this.binanceClient = new BinanceClient();
  }

  /**
   * 测试价格查询功能
   */
  async testPriceQueries(): Promise<void> {
    console.log('🔍 测试价格查询功能...\n');

    const testSymbols = ['MYX', 'ALPHA', 'Q', 'BTCUSDT', 'ETHUSDT'];

    for (const symbol of testSymbols) {
      try {
        const normalizedSymbol = this.normalizeSymbol(symbol);
        const isValid = this.isValidSymbol(normalizedSymbol);

        console.log(`📊 符号: ${symbol}`);
        console.log(`   标准化: ${normalizedSymbol}`);
        console.log(`   验证结果: ${isValid ? '✅ 有效' : '❌ 无效'}`);

        if (isValid) {
          const startTime = Date.now();
          const result = await this.binanceClient.get24hrStats(normalizedSymbol);
          const responseTime = Date.now() - startTime;

          console.log(`   API查询: ✅ 成功 (${responseTime}ms)`);
          console.log(`   价格: $${result.lastPrice}`);
        }

        console.log('');
      } catch (error) {
        console.log(`   API查询: ❌ 失败`);
        console.log(`   错误: ${error instanceof Error ? error.message : String(error)}`);
        console.log('');
      }
    }
  }

  /**
   * 监控系统健康状态
   */
  async checkSystemHealth(): Promise<void> {
    console.log('🏥 系统健康检查...\n');

    // 1. Binance API连接测试
    try {
      const startTime = Date.now();
      await this.binanceClient.ping();
      const responseTime = Date.now() - startTime;
      console.log(`📡 Binance API: ✅ 正常 (${responseTime}ms)`);
    } catch (error) {
      console.log(`📡 Binance API: ❌ 异常`);
      console.log(`   错误: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2. 价格查询成功率测试
    const testSymbols = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT'];
    let successCount = 0;
    let totalTime = 0;

    for (const symbol of testSymbols) {
      try {
        const startTime = Date.now();
        await this.binanceClient.get24hrStats(symbol);
        const responseTime = Date.now() - startTime;
        totalTime += responseTime;
        successCount++;
      } catch (error) {
        log.error(`Price query failed for ${symbol}`, error);
      }
    }

    const successRate = (successCount / testSymbols.length) * 100;
    const avgResponseTime = totalTime / successCount;

    console.log(`📈 价格查询成功率: ${successRate.toFixed(1)}% (${successCount}/${testSymbols.length})`);
    console.log(`⏱️  平均响应时间: ${avgResponseTime.toFixed(0)}ms\n`);
  }

  /**
   * 符号验证逻辑 (与BaseCommandHandler相同)
   */
  private isValidSymbol(symbol: string): boolean {
    return /^[A-Z]{2,10}(USDT|USD)?$/.test(symbol.toUpperCase());
  }

  /**
   * 符号标准化逻辑 (与BaseCommandHandler相同)
   */
  private normalizeSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (!upper.endsWith('USDT') && !upper.endsWith('USD')) {
      return upper + 'USDT';
    }
    return upper;
  }

  /**
   * 生成诊断报告
   */
  async generateReport(): Promise<void> {
    console.log('📋 生成诊断报告...\n');
    console.log('=' .repeat(60));
    console.log('📊 CRYPTO-TGALERT 诊断报告');
    console.log('=' .repeat(60));
    console.log(`🕐 时间: ${new Date().toLocaleString()}`);
    console.log(`🏷️  版本: v2.5.0`);
    console.log('');

    await this.checkSystemHealth();
    await this.testPriceQueries();

    console.log('📋 问题调查状态:');
    console.log('   1. ✅ 符号验证BUG - 已修复');
    console.log('   2. 🔍 预警系统停止 - 监控中');
    console.log('   3. 🔍 统计数据准确性 - 监控中');
    console.log('   4. 🔍 系统稳定性 - 监控中');
    console.log('');
  }
}

// 主程序
async function main() {
  const diagnostics = new SimpleDiagnostics();

  const command = process.argv[2] || 'report';

  switch (command) {
    case 'health':
      await diagnostics.checkSystemHealth();
      break;
    case 'price':
      await diagnostics.testPriceQueries();
      break;
    case 'report':
      await diagnostics.generateReport();
      break;
    default:
      console.log('使用方法:');
      console.log('  npm run simple-diagnostic        # 生成完整报告');
      console.log('  npm run simple-diagnostic health # 系统健康检查');
      console.log('  npm run simple-diagnostic price  # 价格查询测试');
  }
}

if (require.main === module) {
  main().catch(console.error);
}