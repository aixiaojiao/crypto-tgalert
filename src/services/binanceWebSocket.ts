import WebSocket from 'ws';
import { log } from '../utils/logger';

export interface TickerData {
  symbol: string;
  price: string;
  priceChange: string;
  priceChangePercent: string;
  volume: string;
  timestamp: number;
}

export interface KlineData {
  symbol: string;
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  interval: string;
  isClosed: boolean;
}

export interface TradeData {
  symbol: string;
  price: string;
  quantity: string;
  timestamp: number;
  isBuyerMaker: boolean;
}

export interface DepthData {
  symbol: string;
  bids: Array<[string, string]>; // [price, quantity]
  asks: Array<[string, string]>; // [price, quantity]
  lastUpdateId: number;
}

export type WebSocketCallback<T> = (data: T) => void;

export interface WebSocketSubscription {
  stream: string;
  callback: WebSocketCallback<any>;
  id: string;
}

export class BinanceWebSocketClient {
  private ws: WebSocket | null = null;
  private baseUrl = 'wss://stream.binance.com:9443/ws';
  private subscriptions: Map<string, WebSocketSubscription> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds
  private isConnecting = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pingInterval = 30000; // 30 seconds

  constructor() {
    log.info('BinanceWebSocketClient initialized');
  }

  /**
   * Connect to Binance WebSocket
   */
  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      log.debug('WebSocket already connected');
      return;
    }

    if (this.isConnecting) {
      log.debug('WebSocket connection already in progress');
      return;
    }

    this.isConnecting = true;

    try {
      await this.establishConnection();
      this.isConnecting = false;
      this.reconnectAttempts = 0;
    } catch (error) {
      this.isConnecting = false;
      throw error;
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    log.info('Disconnecting WebSocket');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    // Clear reconnection attempts and flags
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    
    this.subscriptions.clear();
    log.info('WebSocket disconnected');
  }

  /**
   * Subscribe to price ticker updates for a symbol
   */
  async subscribeTicker(symbol: string, callback: WebSocketCallback<TickerData>): Promise<string> {
    const stream = `${symbol.toLowerCase()}@ticker`;
    const subscriptionId = this.generateSubscriptionId(stream);

    const subscription: WebSocketSubscription = {
      stream,
      callback: (data: any) => {
        const tickerData: TickerData = {
          symbol: data.s,
          price: data.c,
          priceChange: data.P,
          priceChangePercent: data.p,
          volume: data.v,
          timestamp: data.E
        };
        callback(tickerData);
      },
      id: subscriptionId
    };

    await this.addSubscription(subscription);
    log.info(`Subscribed to ticker for ${symbol}`, { subscriptionId });
    
    return subscriptionId;
  }

  /**
   * Subscribe to kline/candlestick updates
   */
  async subscribeKline(
    symbol: string, 
    interval: string, 
    callback: WebSocketCallback<KlineData>
  ): Promise<string> {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    const subscriptionId = this.generateSubscriptionId(stream);

    const subscription: WebSocketSubscription = {
      stream,
      callback: (data: any) => {
        const k = data.k;
        const klineData: KlineData = {
          symbol: k.s,
          openTime: k.t,
          closeTime: k.T,
          open: k.o,
          high: k.h,
          low: k.l,
          close: k.c,
          volume: k.v,
          interval: k.i,
          isClosed: k.x
        };
        callback(klineData);
      },
      id: subscriptionId
    };

    await this.addSubscription(subscription);
    log.info(`Subscribed to kline for ${symbol} ${interval}`, { subscriptionId });
    
    return subscriptionId;
  }

  /**
   * Subscribe to trade updates
   */
  async subscribeTrade(symbol: string, callback: WebSocketCallback<TradeData>): Promise<string> {
    const stream = `${symbol.toLowerCase()}@trade`;
    const subscriptionId = this.generateSubscriptionId(stream);

    const subscription: WebSocketSubscription = {
      stream,
      callback: (data: any) => {
        const tradeData: TradeData = {
          symbol: data.s,
          price: data.p,
          quantity: data.q,
          timestamp: data.T,
          isBuyerMaker: data.m
        };
        callback(tradeData);
      },
      id: subscriptionId
    };

    await this.addSubscription(subscription);
    log.info(`Subscribed to trades for ${symbol}`, { subscriptionId });
    
    return subscriptionId;
  }

  /**
   * Subscribe to order book depth updates
   */
  async subscribeDepth(symbol: string, callback: WebSocketCallback<DepthData>): Promise<string> {
    const stream = `${symbol.toLowerCase()}@depth`;
    const subscriptionId = this.generateSubscriptionId(stream);

    const subscription: WebSocketSubscription = {
      stream,
      callback: (data: any) => {
        const depthData: DepthData = {
          symbol: data.s,
          bids: data.b,
          asks: data.a,
          lastUpdateId: data.u
        };
        callback(depthData);
      },
      id: subscriptionId
    };

    await this.addSubscription(subscription);
    log.info(`Subscribed to depth for ${symbol}`, { subscriptionId });
    
    return subscriptionId;
  }

  /**
   * Subscribe to multiple symbols price updates at once
   */
  async subscribeMultipleTickers(
    symbols: string[], 
    callback: WebSocketCallback<TickerData>
  ): Promise<string[]> {
    const subscriptionIds: string[] = [];

    for (const symbol of symbols) {
      try {
        const id = await this.subscribeTicker(symbol, callback);
        subscriptionIds.push(id);
      } catch (error) {
        log.error(`Failed to subscribe to ticker for ${symbol}`, error);
      }
    }

    log.info(`Subscribed to ${subscriptionIds.length} ticker streams`);
    return subscriptionIds;
  }

  /**
   * Unsubscribe from a specific subscription
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      log.warn(`Subscription ${subscriptionId} not found`);
      return;
    }

    await this.removeSubscription(subscription);
    log.info(`Unsubscribed from ${subscription.stream}`, { subscriptionId });
  }

  /**
   * Unsubscribe from all subscriptions
   */
  async unsubscribeAll(): Promise<void> {
    const subscriptions = Array.from(this.subscriptions.values());
    
    for (const subscription of subscriptions) {
      await this.removeSubscription(subscription);
    }

    log.info(`Unsubscribed from all ${subscriptions.length} streams`);
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): string {
    if (!this.ws) return 'disconnected';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'connected';
      case WebSocket.CLOSING: return 'closing';
      case WebSocket.CLOSED: return 'closed';
      default: return 'unknown';
    }
  }

  /**
   * Get active subscriptions count
   */
  getActiveSubscriptionsCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get list of subscribed streams
   */
  getActiveStreams(): string[] {
    return Array.from(this.subscriptions.values()).map(sub => sub.stream);
  }

  /**
   * Establish WebSocket connection
   */
  private async establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        log.info('Connecting to Binance WebSocket...', { url: this.baseUrl });
        
        this.ws = new WebSocket(this.baseUrl);

        this.ws.on('open', () => {
          log.info('WebSocket connected successfully');
          this.setupHeartbeat();
          this.resubscribeToStreams();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error: Error) => {
          log.error('WebSocket error', error);
          reject(error);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          log.warn('WebSocket closed', { code, reason: reason.toString() });
          this.handleDisconnection();
        });

        this.ws.on('pong', () => {
          log.debug('WebSocket pong received');
        });

      } catch (error) {
        log.error('Failed to establish WebSocket connection', error);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.stream && message.data) {
        // Stream data message
        const subscription = Array.from(this.subscriptions.values())
          .find(sub => sub.stream === message.stream);
        
        if (subscription) {
          subscription.callback(message.data);
        } else {
          log.debug(`No subscription found for stream: ${message.stream}`);
        }
      } else {
        // Other message types (like subscription confirmations)
        log.debug('WebSocket message received', message);
      }

    } catch (error) {
      log.error('Failed to parse WebSocket message', { error, data: data.toString() });
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleDisconnection(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Attempt to reconnect if we have active subscriptions
    if (this.subscriptions.size > 0 && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnection();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnection(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    log.info(`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`, {
      delay: `${delay}ms`
    });

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        log.error('Reconnection attempt failed', error);
      }
    }, delay);
  }

  /**
   * Setup heartbeat to keep connection alive
   */
  private setupHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        log.debug('WebSocket ping sent');
      }
    }, this.pingInterval);
  }

  /**
   * Resubscribe to all streams after reconnection
   */
  private async resubscribeToStreams(): Promise<void> {
    if (this.subscriptions.size === 0) return;

    log.info(`Resubscribing to ${this.subscriptions.size} streams`);

    const streams = Array.from(this.subscriptions.values()).map(sub => sub.stream);
    
    if (streams.length > 0) {
      await this.subscribeToStreams(streams);
    }
  }

  /**
   * Add a new subscription
   */
  private async addSubscription(subscription: WebSocketSubscription): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    this.subscriptions.set(subscription.id, subscription);
    await this.subscribeToStreams([subscription.stream]);
  }

  /**
   * Remove a subscription
   */
  private async removeSubscription(subscription: WebSocketSubscription): Promise<void> {
    this.subscriptions.delete(subscription.id);
    
    // Check if any other subscriptions use the same stream
    const hasOtherSubscriptions = Array.from(this.subscriptions.values())
      .some(sub => sub.stream === subscription.stream);

    if (!hasOtherSubscriptions) {
      await this.unsubscribeFromStreams([subscription.stream]);
    }
  }

  /**
   * Subscribe to streams via WebSocket
   */
  private async subscribeToStreams(streams: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const message = {
      method: 'SUBSCRIBE',
      params: streams,
      id: Date.now()
    };

    this.ws.send(JSON.stringify(message));
    log.debug('Subscription message sent', { streams });
  }

  /**
   * Unsubscribe from streams via WebSocket
   */
  private async unsubscribeFromStreams(streams: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return; // No point in unsubscribing if not connected
    }

    const message = {
      method: 'UNSUBSCRIBE',
      params: streams,
      id: Date.now()
    };

    this.ws.send(JSON.stringify(message));
    log.debug('Unsubscription message sent', { streams });
  }

  /**
   * Generate unique subscription ID
   */
  private generateSubscriptionId(stream: string): string {
    return `${stream}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const binanceWebSocket = new BinanceWebSocketClient();