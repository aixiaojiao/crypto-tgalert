import { Tweet, TwitterUser, CryptoKeywords } from '../types/twitter';

export class TweetProcessor {
  private static cryptoKeywords: CryptoKeywords = {
    primary: [
      'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency',
      'blockchain', 'defi', 'web3', 'solana', 'sol'
    ],
    secondary: [
      'nft', 'altcoin', 'hodl', 'dapp', 'yield farming', 'liquidity',
      'staking', 'mining', 'hash rate', 'market cap', 'bull run', 'bear market'
    ],
    exchanges: [
      'binance', 'coinbase', 'kraken', 'ftx', 'kucoin', 'bybit',
      'okx', 'huobi', 'gate.io', 'bitfinex'
    ],
    symbols: [
      'btc', 'eth', 'sol', 'ada', 'dot', 'matic', 'avax', 'link',
      'uni', 'aave', 'bnb', 'usdt', 'usdc', 'dai', 'luna', 'atom'
    ]
  };

  static formatTweetForTelegram(tweet: Tweet, user: TwitterUser): string {
    const tweetUrl = `https://twitter.com/${user.username}/status/${tweet.id}`;
    const timestamp = new Date(tweet.created_at).toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Format metrics
    const metrics = tweet.public_metrics;
    const metricsText = metrics ? 
      `❤️ ${this.formatNumber(metrics.like_count)} | 🔄 ${this.formatNumber(metrics.retweet_count)} | 💬 ${this.formatNumber(metrics.reply_count)}` :
      '';

    // Highlight crypto keywords in tweet text
    let formattedText = this.highlightCryptoKeywords(tweet.text);

    // Format user info
    const verifiedBadge = user.verified ? ' ✅' : '';
    const userHeader = `👤 **${user.name}**${verifiedBadge} (@${user.username})`;
    
    // Add follower count if available
    const followerCount = user.public_metrics?.followers_count;
    const followerText = followerCount ? ` • ${this.formatNumber(followerCount)} followers` : '';

    return `${userHeader}${followerText}

📝 ${formattedText}

⏰ ${timestamp} UTC
${metricsText}

🔗 [View Tweet](${tweetUrl})`;
  }

  static highlightCryptoKeywords(text: string): string {
    let result = text;
    
    // Handle cashtags first to avoid double highlighting
    result = result.replace(/\$([A-Z]{2,5})\b/g, '**$$$1**');

    // Handle hashtags
    result = result.replace(/#([a-zA-Z0-9_]+)/g, '**#$1**');
    
    // Combine all keywords for highlighting (excluding symbols already handled as cashtags)
    const allKeywords = [
      ...this.cryptoKeywords.primary,
      ...this.cryptoKeywords.secondary,
      ...this.cryptoKeywords.exchanges
    ];

    // Sort by length (longest first) to avoid partial matches
    const sortedKeywords = allKeywords.sort((a, b) => b.length - a.length);

    for (const keyword of sortedKeywords) {
      // Create regex for word boundaries, case insensitive, but avoid already highlighted text
      const regex = new RegExp(`(?<!\\*\\*)\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!\\*\\*)`, 'gi');
      result = result.replace(regex, `**$&**`);
    }

    return result;
  }

  static isCryptoRelevant(tweetText: string): boolean {
    const lowerText = tweetText.toLowerCase();
    
    // Check for primary crypto keywords (higher confidence)
    const hasPrimaryKeyword = this.cryptoKeywords.primary.some(keyword =>
      lowerText.includes(keyword.toLowerCase())
    );

    if (hasPrimaryKeyword) return true;

    // Check for cashtags with crypto symbols
    const hasCryptoSymbol = this.cryptoKeywords.symbols.some(symbol =>
      new RegExp(`\\$${symbol}\\b`, 'i').test(tweetText)
    );

    if (hasCryptoSymbol) return true;

    // Check for combination of secondary keywords and exchanges
    const hasSecondaryKeyword = this.cryptoKeywords.secondary.some(keyword =>
      lowerText.includes(keyword.toLowerCase())
    );

    const hasExchange = this.cryptoKeywords.exchanges.some(exchange =>
      lowerText.includes(exchange.toLowerCase())
    );

    // Require at least one secondary keyword or exchange mention
    return hasSecondaryKeyword || hasExchange;
  }

  static extractCryptoMentions(tweet: Tweet): {
    symbols: string[];
    keywords: string[];
    exchanges: string[];
    hashtags: string[];
    cashtags: string[];
  } {
    const text = tweet.text.toLowerCase();
    const result = {
      symbols: [] as string[],
      keywords: [] as string[],
      exchanges: [] as string[],
      hashtags: [] as string[],
      cashtags: [] as string[]
    };

    // Extract symbols
    this.cryptoKeywords.symbols.forEach(symbol => {
      if (new RegExp(`\\$${symbol}\\b`, 'i').test(tweet.text)) {
        result.symbols.push(symbol.toUpperCase());
      }
    });

    // Extract keywords
    [...this.cryptoKeywords.primary, ...this.cryptoKeywords.secondary].forEach(keyword => {
      if (text.includes(keyword.toLowerCase())) {
        result.keywords.push(keyword);
      }
    });

    // Extract exchanges
    this.cryptoKeywords.exchanges.forEach(exchange => {
      if (text.includes(exchange.toLowerCase())) {
        result.exchanges.push(exchange);
      }
    });

    // Extract hashtags and cashtags from entities if available
    if (tweet.entities?.hashtags) {
      result.hashtags = tweet.entities.hashtags.map(h => h.tag);
    }

    if (tweet.entities?.cashtags) {
      result.cashtags = tweet.entities.cashtags.map(c => c.tag);
    }

    return result;
  }

  static calculateRelevanceScore(tweet: Tweet): number {
    let score = 0;
    const text = tweet.text.toLowerCase();
    const mentions = this.extractCryptoMentions(tweet);

    // Primary keywords get higher score
    this.cryptoKeywords.primary.forEach(keyword => {
      if (text.includes(keyword.toLowerCase())) {
        score += 10;
      }
    });

    // Secondary keywords
    this.cryptoKeywords.secondary.forEach(keyword => {
      if (text.includes(keyword.toLowerCase())) {
        score += 5;
      }
    });

    // Crypto symbols
    score += mentions.symbols.length * 8;

    // Exchange mentions
    score += mentions.exchanges.length * 6;

    // Hashtags and cashtags
    score += mentions.hashtags.length * 3;
    score += mentions.cashtags.length * 7;

    // Engagement boost (high engagement might indicate important news)
    const metrics = tweet.public_metrics;
    if (metrics) {
      const engagementScore = Math.log10((metrics.like_count + metrics.retweet_count + 1));
      score += engagementScore * 2;
    }

    return Math.round(score);
  }

  static shouldForwardToTelegram(tweet: Tweet, _user: TwitterUser, minRelevanceScore: number = 10): boolean {
    // Skip retweets for cleaner feed
    if (tweet.text.startsWith('RT @')) return false;

    // Check crypto relevance
    if (!this.isCryptoRelevant(tweet.text)) return false;

    // Check relevance score
    const score = this.calculateRelevanceScore(tweet);
    if (score < minRelevanceScore) return false;

    // Additional quality filters
    if (tweet.text.length < 20) return false; // Too short
    if (tweet.text.split(/\s+/).length < 5) return false; // Too few words

    return true;
  }

  private static formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  static createTweetSummary(tweet: Tweet, _user: TwitterUser): string {
    const mentions = this.extractCryptoMentions(tweet);
    const relevanceScore = this.calculateRelevanceScore(tweet);
    
    return `🔥 Score: ${relevanceScore} | 🪙 ${mentions.symbols.join(', ') || 'N/A'} | 📊 ${mentions.keywords.slice(0, 3).join(', ') || 'general'}`;
  }

  // Utility method for testing and debugging
  static analyzeTweet(tweet: Tweet, user: TwitterUser): {
    isRelevant: boolean;
    score: number;
    mentions: ReturnType<typeof TweetProcessor.extractCryptoMentions>;
    shouldForward: boolean;
    summary: string;
    formattedText: string;
  } {
    return {
      isRelevant: this.isCryptoRelevant(tweet.text),
      score: this.calculateRelevanceScore(tweet),
      mentions: this.extractCryptoMentions(tweet),
      shouldForward: this.shouldForwardToTelegram(tweet, user),
      summary: this.createTweetSummary(tweet, user),
      formattedText: this.formatTweetForTelegram(tweet, user)
    };
  }
}