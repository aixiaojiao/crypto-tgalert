import { TwitterUser, Tweet } from '../types/twitter';
import logger from '../utils/logger';

export class TwitterMockClient {
  private mockUsers: Map<string, TwitterUser> = new Map();
  private mockTweets: Map<string, Tweet[]> = new Map();
  private lastTweetIds: Map<string, string> = new Map();

  constructor() {
    this.initializeMockData();
  }

  private initializeMockData(): void {
    // Mock users with crypto focus
    const mockUsers: TwitterUser[] = [
      {
        id: '44196397',
        username: 'elonmusk',
        name: 'Elon Musk',
        profile_image_url: 'https://pbs.twimg.com/profile_images/1590968738358079488/IY9Gx6Ok_400x400.jpg',
        public_metrics: {
          followers_count: 150000000,
          following_count: 500,
          tweet_count: 25000
        },
        verified: true,
        description: 'Tesla, SpaceX, Neuralink, xAI'
      },
      {
        id: '357312062',
        username: 'VitalikButerin',
        name: 'Vitalik Buterin',
        profile_image_url: 'https://pbs.twimg.com/profile_images/977496875887558661/L86xyLF4_400x400.jpg',
        public_metrics: {
          followers_count: 5000000,
          following_count: 2000,
          tweet_count: 15000
        },
        verified: true,
        description: 'Ethereum founder'
      },
      {
        id: '1194052901909389314',
        username: 'cz_binance',
        name: 'CZ Binance',
        profile_image_url: 'https://pbs.twimg.com/profile_images/1590968738358079488/IY9Gx6Ok_400x400.jpg',
        public_metrics: {
          followers_count: 8000000,
          following_count: 1500,
          tweet_count: 12000
        },
        verified: true,
        description: 'Binance CEO'
      },
      {
        id: '50393960',
        username: 'BillGates',
        name: 'Bill Gates',
        profile_image_url: 'https://pbs.twimg.com/profile_images/1414439092373254149/r1Z9Mfml_400x400.jpg',
        public_metrics: {
          followers_count: 60000000,
          following_count: 300,
          tweet_count: 8000
        },
        verified: true,
        description: 'Sharing things I\'m learning through my foundation work and other interests.'
      }
    ];

    mockUsers.forEach(user => {
      this.mockUsers.set(user.username.toLowerCase(), user);
    });

    // Initialize mock tweets for each user
    this.generateMockTweets();
  }

  private generateMockTweets(): void {
    // Crypto keywords are used implicitly in the mock tweet templates

    const mockTweetTemplates = [
      {
        template: "Just analyzed the latest #Bitcoin metrics. The on-chain data suggests strong institutional accumulation. $BTC might see significant movement soon. 📈",
        username: 'elonmusk'
      },
      {
        template: "Ethereum's upcoming upgrade will significantly improve scalability. The future of #DeFi looks promising with these developments. $ETH",
        username: 'VitalikButerin'
      },
      {
        template: "Binance continues to lead innovation in the #crypto space. Our new features will make trading more accessible to everyone. $BNB",
        username: 'cz_binance'
      },
      {
        template: "Interesting developments in blockchain technology for healthcare applications. The potential for secure, decentralized medical records is enormous.",
        username: 'BillGates'
      },
      {
        template: "The #Web3 ecosystem is evolving rapidly. Developers building on Ethereum are creating incredible applications that seemed impossible just years ago.",
        username: 'VitalikButerin'
      },
      {
        template: "Tesla's bitcoin holdings remain strong. We believe in the long-term potential of cryptocurrency as a store of value. $BTC #Bitcoin",
        username: 'elonmusk'
      },
      {
        template: "Market volatility is normal in crypto. Focus on building, not trading. The technology fundamentals remain solid. #HODL",
        username: 'cz_binance'
      },
      {
        template: "Proof of Stake consensus mechanism in Ethereum 2.0 reduces energy consumption by 99.9%. This is a game-changer for sustainability in #blockchain",
        username: 'VitalikButerin'
      }
    ];

    this.mockUsers.forEach((user) => {
      const userTweets: Tweet[] = [];
      const relevantTemplates = mockTweetTemplates.filter(t => t.username === user.username);
      
      relevantTemplates.forEach((template, index) => {
        const tweetId = `mock_${user.id}_${Date.now()}_${index}`;
        const tweet: Tweet = {
          id: tweetId,
          text: template.template,
          author_id: user.id,
          created_at: new Date(Date.now() - (index * 3600000)).toISOString(), // Spread over hours
          public_metrics: {
            retweet_count: Math.floor(Math.random() * 1000),
            like_count: Math.floor(Math.random() * 5000),
            reply_count: Math.floor(Math.random() * 500),
            quote_count: Math.floor(Math.random() * 100)
          },
          entities: {
            hashtags: this.extractHashtags(template.template),
            cashtags: this.extractCashtags(template.template)
          }
        };
        userTweets.push(tweet);
      });

      this.mockTweets.set(user.id, userTweets);
      
      // Set last tweet ID for monitoring simulation (don't set initially to simulate fresh start)
      // The getNewTweetsForUser method will handle first-time setup
    });
  }

  private extractHashtags(text: string): { tag: string }[] {
    const hashtags = text.match(/#(\w+)/g) || [];
    return hashtags.map(tag => ({ tag: tag.substring(1) }));
  }

  private extractCashtags(text: string): { tag: string }[] {
    const cashtags = text.match(/\$([A-Z]{2,5})/g) || [];
    return cashtags.map(tag => ({ tag: tag.substring(1) }));
  }

  async getUserByUsername(username: string): Promise<TwitterUser | null> {
    logger.info(`[MOCK] Fetching user: @${username}`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const user = this.mockUsers.get(username.toLowerCase());
    if (!user) {
      logger.warn(`[MOCK] User @${username} not found`);
      return null;
    }

    return user;
  }

  async getUserTweets(userId: string, maxResults: number = 10): Promise<Tweet[]> {
    logger.info(`[MOCK] Fetching tweets for user ID: ${userId}`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const tweets = this.mockTweets.get(userId) || [];
    return tweets.slice(0, maxResults);
  }

  async searchTweets(query: string, maxResults: number = 10): Promise<Tweet[]> {
    logger.info(`[MOCK] Searching tweets with query: ${query}`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const allTweets: Tweet[] = [];
    this.mockTweets.forEach(tweets => {
      allTweets.push(...tweets);
    });

    // Simple search simulation - check if query keywords exist in tweet text
    const queryWords = query.toLowerCase().split(/\s+/).filter(word => 
      !word.startsWith('-') && !word.includes(':') && word.length > 2
    );

    const filteredTweets = allTweets.filter(tweet => {
      const tweetText = tweet.text.toLowerCase();
      return queryWords.some(word => tweetText.includes(word.replace(/[()]/g, '')));
    });

    return filteredTweets
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, maxResults);
  }

  async searchCryptoTweets(maxResults: number = 10): Promise<Tweet[]> {
    return this.searchTweets('bitcoin OR ethereum OR crypto OR blockchain OR defi', maxResults);
  }

  // Simulate getting new tweets for monitoring
  async getNewTweetsForUser(username: string): Promise<Tweet[]> {
    const user = await this.getUserByUsername(username);
    if (!user) return [];

    const currentTweets = await this.getUserTweets(user.id, 5);
    const lastSeenId = this.lastTweetIds.get(username.toLowerCase());

    if (!lastSeenId) {
      // First time checking, return latest tweet only
      if (currentTweets.length > 0) {
        this.lastTweetIds.set(username.toLowerCase(), currentTweets[0].id);
        return currentTweets.slice(0, 1);
      }
      return [];
    }

    // Find tweets newer than last seen
    const lastSeenIndex = currentTweets.findIndex(tweet => tweet.id === lastSeenId);
    const newTweets = lastSeenIndex === -1 ? currentTweets : currentTweets.slice(0, lastSeenIndex);

    // Update last seen ID
    if (newTweets.length > 0) {
      this.lastTweetIds.set(username.toLowerCase(), newTweets[0].id);
    }

    return newTweets;
  }

  // Add a new mock tweet (for testing new tweet detection)
  addMockTweet(username: string, tweetText: string): boolean {
    const user = this.mockUsers.get(username.toLowerCase());
    if (!user) return false;

    const newTweet: Tweet = {
      id: `mock_${user.id}_${Date.now()}_new`,
      text: tweetText,
      author_id: user.id,
      created_at: new Date().toISOString(),
      public_metrics: {
        retweet_count: 0,
        like_count: Math.floor(Math.random() * 100),
        reply_count: 0,
        quote_count: 0
      },
      entities: {
        hashtags: this.extractHashtags(tweetText),
        cashtags: this.extractCashtags(tweetText)
      }
    };

    const userTweets = this.mockTweets.get(user.id) || [];
    userTweets.unshift(newTweet); // Add to beginning
    this.mockTweets.set(user.id, userTweets);

    return true;
  }

  isClientConfigured(): boolean {
    return true; // Mock client is always "configured"
  }

  getRateLimitStatus(): Map<string, any> {
    return new Map([
      ['users_by_username', { limit: 300, remaining: 299, reset: Date.now() + 900000 }],
      ['user_tweets', { limit: 300, remaining: 298, reset: Date.now() + 900000 }],
      ['tweet_search', { limit: 180, remaining: 179, reset: Date.now() + 900000 }]
    ]);
  }
}