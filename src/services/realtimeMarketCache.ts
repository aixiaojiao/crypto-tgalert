import { BinanceWebSocketClient, TickerData } from './binanceWebSocket';
import { BinanceClient } from './binance';
import { log } from '../utils/logger';
import { filterTradingPairs, getTokenRiskLevel, getRiskIcon } from '../config/tokenLists';
import { EventEmitter } from 'events';
import { priceAlertService } from './priceAlertService';

export interface MarketTickerData {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  timestamp: number;
  riskLevel: string;
  riskIcon: string;
}

export interface RankingResult {
  symbol: string;
  position: number;
  priceChangePercent: number;
  price: number;
  priceChange: number;
  volume: number;
  riskLevel: string;
  riskIcon: string;
}

/**
 * 实时市场数据缓存管理器
 * 通过WebSocket维护所有交易对的实时24h统计数据
 * 提供毫秒级响应的涨跌幅排行榜查询
 */
export class RealtimeMarketCache extends EventEmitter {
  private wsClient: BinanceWebSocketClient;
  private binanceClient: BinanceClient;
  private marketData: Map<string, MarketTickerData> = new Map();
  private subscriptionId: string | null = null;
  private isConnected: boolean = false;
  private validSymbols: Set<string> = new Set();
  private previousRankings: RankingResult[] = [];

  // 性能统计
  private stats = {
    totalUpdates: 0,
    lastUpdateTime: 0,
    avgUpdateSize: 0,
    connectionTime: 0
  };

  constructor() {
    super();
    this.wsClient = new BinanceWebSocketClient();
    this.binanceClient = new BinanceClient();
    this.initializeValidSymbols();
  }

  /**
   * 初始化有效交易对列表
   */
  private async initializeValidSymbols(): Promise<void> {
    try {
      const allSymbols = await this.binanceClient.getFuturesTradingSymbols();
      const validSymbolsList = filterTradingPairs(allSymbols);
      this.validSymbols = new Set(validSymbolsList);
      log.info(`Initialized ${this.validSymbols.size} valid trading pairs for realtime cache`);
    } catch (error) {
      log.error('Failed to initialize valid symbols', error);
      // 如果API调用失败，使用一些常见的交易对作为fallback
      const fallbackSymbols = [
        'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT',
        'MATICUSDT', 'AVAXUSDT', 'ATOMUSDT', 'NEARUSDT', 'FTMUSDT', 'SANDUSDT'
      ];
      this.validSymbols = new Set(filterTradingPairs(fallbackSymbols));
      log.warn(`Using fallback symbols: ${this.validSymbols.size} pairs`);
    }
  }

  /**
   * 开始实时数据订阅
   */
  async start(): Promise<void> {
    try {
      if (this.isConnected) {
        log.warn('Realtime market cache is already running');
        return;
      }

      log.info('Starting realtime market cache...');
      this.stats.connectionTime = Date.now();

      await this.wsClient.connect();

      // 订阅全市场ticker流
      this.subscriptionId = await this.wsClient.subscribeAllMarketTickers(
        (tickerDataArray: TickerData[]) => {
          this.handleMarketTickerUpdate(tickerDataArray);
        }
      );

      this.isConnected = true;
      log.info('Realtime market cache started successfully', {
        subscriptionId: this.subscriptionId
      });

    } catch (error) {
      log.error('Failed to start realtime market cache', error);
      throw error;
    }
  }

  /**
   * 停止实时数据订阅
   */
  async stop(): Promise<void> {
    try {
      if (!this.isConnected) {
        log.warn('Realtime market cache is not running');
        return;
      }

      if (this.subscriptionId) {
        await this.wsClient.unsubscribe(this.subscriptionId);
        this.subscriptionId = null;
      }

      await this.wsClient.disconnect();
      this.isConnected = false;
      this.marketData.clear();

      log.info('Realtime market cache stopped');
    } catch (error) {
      log.error('Failed to stop realtime market cache', error);
      throw error;
    }
  }

  /**
   * 处理市场ticker数据更新
   */
  private handleMarketTickerUpdate(tickerDataArray: TickerData[]): void {
    const startTime = Date.now();
    let validUpdates = 0;

    for (const ticker of tickerDataArray) {
      // 只处理有效的交易对
      if (!this.validSymbols.has(ticker.symbol)) {
        continue;
      }

      const marketData: MarketTickerData = {
        symbol: ticker.symbol,
        price: parseFloat(ticker.price),
        priceChange: parseFloat(ticker.priceChange),
        priceChangePercent: parseFloat(ticker.priceChangePercent),
        volume: parseFloat(ticker.volume),
        timestamp: ticker.timestamp,
        riskLevel: getTokenRiskLevel(ticker.symbol),
        riskIcon: getRiskIcon(getTokenRiskLevel(ticker.symbol))
      };

      this.marketData.set(ticker.symbol, marketData);
      validUpdates++;

      // 触发价格报警检查
      priceAlertService.onPriceUpdate(
        ticker.symbol,
        marketData.price,
        marketData.volume
      ).catch(error => {
        log.error('Price alert service error', { symbol: ticker.symbol, error });
      });
    }

    // 更新统计信息
    this.stats.totalUpdates++;
    this.stats.lastUpdateTime = Date.now();
    this.stats.avgUpdateSize = Math.round(
      (this.stats.avgUpdateSize * (this.stats.totalUpdates - 1) + validUpdates) / this.stats.totalUpdates
    );

    const processingTime = Date.now() - startTime;
    log.debug(`Processed ${validUpdates} ticker updates in ${processingTime}ms`, {
      totalSymbols: this.marketData.size,
      updateCount: this.stats.totalUpdates
    });

    // 检测排名变化并发射事件
    this.detectRankingChanges();
  }

  /**
   * 检测涨幅榜排名变化
   */
  private detectRankingChanges(): void {
    // 避免频繁检测，每5秒检测一次
    if (this.stats.totalUpdates % 5 !== 0) return;

    const currentRankings = this.getTopGainers(15, 10000); // 获取前15名用于检测

    if (this.previousRankings.length === 0) {
      // 首次运行，保存当前排名
      this.previousRankings = currentRankings;
      return;
    }

    const changes = this.compareRankings(currentRankings, this.previousRankings);

    if (changes.length > 0) {
      this.emit('rankingChanged', {
        current: currentRankings.slice(0, 10), // 只推送前10名
        previous: this.previousRankings.slice(0, 10),
        changes: changes
      });

      log.debug(`Detected ${changes.length} ranking changes`, {
        changes: changes.map(c => `${c.symbol}: ${c.changeType}`)
      });
    }

    this.previousRankings = currentRankings;
  }

  /**
   * 比较两次排名，找出重要变化
   */
  private compareRankings(current: RankingResult[], previous: RankingResult[]): Array<{
    symbol: string;
    currentPosition: number;
    previousPosition?: number;
    changeType: 'new_entry' | 'position_change' | 'exit';
    changeValue?: number;
    priceChangePercent: number;
  }> {
    const changes: Array<any> = [];
    const previousMap = new Map(previous.map(r => [r.symbol, r]));
    const currentMap = new Map(current.slice(0, 10).map(r => [r.symbol, r]));

    // 检测新进入前10的币种
    for (const currentRanking of current.slice(0, 10)) {
      const previousRanking = previousMap.get(currentRanking.symbol);

      if (!previousRanking) {
        // 新进入前10
        if (currentRanking.priceChangePercent >= 10) { // 10%阈值
          changes.push({
            symbol: currentRanking.symbol,
            currentPosition: currentRanking.position,
            changeType: 'new_entry',
            priceChangePercent: currentRanking.priceChangePercent
          });
        }
      } else {
        // 排名变化
        const positionChange = previousRanking.position - currentRanking.position;
        if (Math.abs(positionChange) >= 3) { // 排名变化超过3位
          changes.push({
            symbol: currentRanking.symbol,
            currentPosition: currentRanking.position,
            previousPosition: previousRanking.position,
            changeType: 'position_change',
            changeValue: positionChange,
            priceChangePercent: currentRanking.priceChangePercent
          });
        }
      }
    }

    // 检测退出前10的币种
    for (const previousRanking of previous.slice(0, 10)) {
      if (!currentMap.has(previousRanking.symbol)) {
        changes.push({
          symbol: previousRanking.symbol,
          previousPosition: previousRanking.position,
          changeType: 'exit',
          priceChangePercent: previousRanking.priceChangePercent
        });
      }
    }

    return changes;
  }

  /**
   * 获取涨幅榜
   */
  getTopGainers(limit: number = 10, minVolumeUSDT: number = 10000): RankingResult[] {
    const gainers = Array.from(this.marketData.values())
      .filter(data =>
        data.priceChangePercent > 0 &&
        data.volume > minVolumeUSDT
      )
      .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
      .slice(0, limit)
      .map((data, index) => ({
        symbol: data.symbol,
        position: index + 1,
        priceChangePercent: data.priceChangePercent,
        price: data.price,
        priceChange: data.priceChange,
        volume: data.volume,
        riskLevel: data.riskLevel,
        riskIcon: data.riskIcon
      }));

    log.debug(`Retrieved ${gainers.length} top gainers`, {
      topGainer: gainers[0]?.symbol,
      topGainPercent: gainers[0]?.priceChangePercent
    });

    return gainers;
  }

  /**
   * 获取跌幅榜
   */
  getTopLosers(limit: number = 10, minVolumeUSDT: number = 10000): RankingResult[] {
    const losers = Array.from(this.marketData.values())
      .filter(data =>
        data.priceChangePercent < 0 &&
        data.volume > minVolumeUSDT
      )
      .sort((a, b) => a.priceChangePercent - b.priceChangePercent)
      .slice(0, limit)
      .map((data, index) => ({
        symbol: data.symbol,
        position: index + 1,
        priceChangePercent: data.priceChangePercent,
        price: data.price,
        priceChange: data.priceChange,
        volume: data.volume,
        riskLevel: data.riskLevel,
        riskIcon: data.riskIcon
      }));

    log.debug(`Retrieved ${losers.length} top losers`, {
      topLoser: losers[0]?.symbol,
      topLossPercent: losers[0]?.priceChangePercent
    });

    return losers;
  }

  /**
   * 获取指定币种的实时数据
   */
  getTickerData(symbol: string): MarketTickerData | null {
    return this.marketData.get(symbol) || null;
  }

  /**
   * 检查缓存是否就绪
   */
  isReady(): boolean {
    return this.isConnected && this.marketData.size > 0;
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    const uptime = this.stats.connectionTime ? Date.now() - this.stats.connectionTime : 0;

    return {
      isConnected: this.isConnected,
      totalSymbols: this.marketData.size,
      validSymbols: this.validSymbols.size,
      totalUpdates: this.stats.totalUpdates,
      lastUpdateTime: this.stats.lastUpdateTime,
      avgUpdateSize: this.stats.avgUpdateSize,
      uptimeMs: uptime,
      uptimeFormatted: this.formatUptime(uptime)
    };
  }

  /**
   * 格式化运行时间
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// 创建全局实例
export const realtimeMarketCache = new RealtimeMarketCache();