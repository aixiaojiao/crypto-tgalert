import { TwitterClient } from '../../services/twitter';
import { TwitterMockClient } from '../../services/twitterMock';
import { TweetProcessor } from '../../services/tweetProcessor';
import { SocialMonitorService } from '../../services/socialMonitor';
import { TwitterUser, Tweet } from '../../types/twitter';
import { initDatabase, closeDatabase } from '../../database/connection';

describe('Twitter Integration', () => {
  describe('TwitterMockClient', () => {
    let mockClient: TwitterMockClient;

    beforeEach(() => {
      mockClient = new TwitterMockClient();
    });

    test('should return mock user data for known users', async () => {
      const user = await mockClient.getUserByUsername('elonmusk');
      
      expect(user).toBeDefined();
      expect(user?.username).toBe('elonmusk');
      expect(user?.name).toBe('Elon Musk');
      expect(user?.id).toBe('44196397');
      expect(user?.verified).toBe(true);
      expect(user?.public_metrics).toBeDefined();
      expect(user?.public_metrics?.followers_count).toBeGreaterThan(1000000);
    });

    test('should return null for unknown users', async () => {
      const user = await mockClient.getUserByUsername('nonexistentuser123456');
      expect(user).toBeNull();
    });

    test('should return mock crypto tweets for known users', async () => {
      const user = await mockClient.getUserByUsername('VitalikButerin');
      expect(user).toBeDefined();

      const tweets = await mockClient.getUserTweets(user!.id);
      
      expect(Array.isArray(tweets)).toBe(true);
      expect(tweets.length).toBeGreaterThan(0);
      
      const cryptoTweet = tweets.find(tweet => 
        TweetProcessor.isCryptoRelevant(tweet.text)
      );
      expect(cryptoTweet).toBeDefined();
    });

    test('should simulate crypto tweet search', async () => {
      const tweets = await mockClient.searchCryptoTweets(5);
      
      expect(Array.isArray(tweets)).toBe(true);
      expect(tweets.length).toBeGreaterThan(0);
      expect(tweets.length).toBeLessThanOrEqual(5);
      
      // All returned tweets should be crypto relevant
      tweets.forEach(tweet => {
        expect(TweetProcessor.isCryptoRelevant(tweet.text)).toBe(true);
      });
    });

    test('should detect new tweets correctly', async () => {
      const username = 'elonmusk';
      
      // Get initial tweets
      const initialTweets = await mockClient.getNewTweetsForUser(username);
      expect(initialTweets.length).toBeGreaterThan(0);
      
      // Add a new mock tweet
      const success = mockClient.addMockTweet(username, 'Bitcoin is the future of money! $BTC #cryptocurrency');
      expect(success).toBe(true);
      
      // Check for new tweets again
      const newTweets = await mockClient.getNewTweetsForUser(username);
      expect(newTweets.length).toBeGreaterThan(0);
      
      const latestTweet = newTweets[0];
      expect(latestTweet.text).toContain('Bitcoin is the future of money');
      expect(TweetProcessor.isCryptoRelevant(latestTweet.text)).toBe(true);
    });

    test('should report as configured', () => {
      expect(mockClient.isClientConfigured()).toBe(true);
    });

    test('should return mock rate limit status', () => {
      const rateLimits = mockClient.getRateLimitStatus();
      
      expect(rateLimits).toBeInstanceOf(Map);
      expect(rateLimits.size).toBeGreaterThan(0);
      
      const userLookupLimit = rateLimits.get('users_by_username');
      expect(userLookupLimit).toBeDefined();
      expect(userLookupLimit.limit).toBeGreaterThan(0);
      expect(userLookupLimit.remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe('TwitterClient (without credentials)', () => {
    let client: TwitterClient;

    beforeEach(() => {
      client = new TwitterClient(); // No bearer token
    });

    test('should handle missing credentials gracefully', async () => {
      expect(client.isClientConfigured()).toBe(false);
      
      const user = await client.getUserByUsername('elonmusk');
      expect(user).toBeNull();
      
      const tweets = await client.getUserTweets('123', 5);
      expect(tweets).toEqual([]);
      
      const searchResults = await client.searchCryptoTweets(5);
      expect(searchResults).toEqual([]);
    });
  });

  describe('TweetProcessor', () => {
    let sampleUser: TwitterUser;
    let cryptoTweet: Tweet;
    let nonCryptoTweet: Tweet;

    beforeEach(() => {
      sampleUser = {
        id: '123456789',
        username: 'cryptoexpert',
        name: 'Crypto Expert',
        verified: true,
        public_metrics: {
          followers_count: 50000,
          following_count: 1000,
          tweet_count: 5000
        }
      };

      cryptoTweet = {
        id: 'tweet123',
        text: 'Bitcoin just broke $50k! The bull run is here. $BTC #cryptocurrency #bitcoin',
        author_id: sampleUser.id,
        created_at: new Date().toISOString(),
        public_metrics: {
          retweet_count: 150,
          like_count: 500,
          reply_count: 25,
          quote_count: 10
        },
        entities: {
          hashtags: [{ tag: 'cryptocurrency' }, { tag: 'bitcoin' }],
          cashtags: [{ tag: 'BTC' }]
        }
      };

      nonCryptoTweet = {
        id: 'tweet456',
        text: 'Beautiful sunset today! Nature is amazing.',
        author_id: sampleUser.id,
        created_at: new Date().toISOString(),
        public_metrics: {
          retweet_count: 5,
          like_count: 20,
          reply_count: 2,
          quote_count: 0
        }
      };
    });

    test('should detect crypto relevant tweets', () => {
      expect(TweetProcessor.isCryptoRelevant(cryptoTweet.text)).toBe(true);
      expect(TweetProcessor.isCryptoRelevant(nonCryptoTweet.text)).toBe(false);
      
      // Test various crypto keywords
      expect(TweetProcessor.isCryptoRelevant('Ethereum gas fees are high today')).toBe(true);
      expect(TweetProcessor.isCryptoRelevant('DeFi yields looking good')).toBe(true);
      expect(TweetProcessor.isCryptoRelevant('Trading on Binance today')).toBe(true);
      expect(TweetProcessor.isCryptoRelevant('$ETH is pumping')).toBe(true);
    });

    test('should format tweets correctly for Telegram', () => {
      const formatted = TweetProcessor.formatTweetForTelegram(cryptoTweet, sampleUser);
      
      expect(formatted).toContain(sampleUser.name);
      expect(formatted).toContain(sampleUser.username);
      expect(formatted).toContain('✅'); // Verified badge
      expect(formatted).toContain('**Bitcoin**'); // Highlighted keyword
      expect(formatted).toContain('**$BTC**'); // Highlighted cashtag
      expect(formatted).toContain('❤️'); // Like emoji
      expect(formatted).toContain('🔄'); // Retweet emoji
      expect(formatted).toContain('View Tweet');
      expect(formatted).toContain(`https://twitter.com/${sampleUser.username}/status/${cryptoTweet.id}`);
    });

    test('should highlight crypto keywords correctly', () => {
      const text = 'Bitcoin and Ethereum are leading DeFi innovation on Binance';
      const highlighted = TweetProcessor.highlightCryptoKeywords(text);
      
      expect(highlighted).toContain('**Bitcoin**');
      expect(highlighted).toContain('**Ethereum**');
      expect(highlighted).toContain('**DeFi**');
      expect(highlighted).toContain('**Binance**');
    });

    test('should extract crypto mentions correctly', () => {
      const mentions = TweetProcessor.extractCryptoMentions(cryptoTweet);
      
      expect(mentions.symbols).toContain('BTC');
      expect(mentions.keywords).toContain('bitcoin');
      expect(mentions.hashtags).toContain('cryptocurrency');
      expect(mentions.hashtags).toContain('bitcoin');
    });

    test('should calculate relevance score correctly', () => {
      const cryptoScore = TweetProcessor.calculateRelevanceScore(cryptoTweet);
      const nonCryptoScore = TweetProcessor.calculateRelevanceScore(nonCryptoTweet);
      
      expect(cryptoScore).toBeGreaterThan(nonCryptoScore);
      expect(cryptoScore).toBeGreaterThan(10); // Should have decent score
      expect(nonCryptoScore).toBeLessThan(5); // Should have low score
    });

    test('should determine if tweet should be forwarded to Telegram', () => {
      expect(TweetProcessor.shouldForwardToTelegram(cryptoTweet, sampleUser)).toBe(true);
      expect(TweetProcessor.shouldForwardToTelegram(nonCryptoTweet, sampleUser)).toBe(false);
      
      // Test retweet filtering
      const retweet = { ...cryptoTweet, text: 'RT @someone: Bitcoin is amazing' };
      expect(TweetProcessor.shouldForwardToTelegram(retweet, sampleUser)).toBe(false);
      
      // Test short tweet filtering
      const shortTweet = { ...cryptoTweet, text: 'BTC up' };
      expect(TweetProcessor.shouldForwardToTelegram(shortTweet, sampleUser)).toBe(false);
    });

    test('should create comprehensive tweet analysis', () => {
      const analysis = TweetProcessor.analyzeTweet(cryptoTweet, sampleUser);
      
      expect(analysis.isRelevant).toBe(true);
      expect(analysis.score).toBeGreaterThan(10);
      expect(analysis.shouldForward).toBe(true);
      expect(analysis.mentions.symbols).toContain('BTC');
      expect(analysis.summary).toContain('Score:');
      expect(analysis.formattedText).toContain('**Bitcoin**');
    });
  });

  describe('SocialMonitorService', () => {
    let monitorService: SocialMonitorService;
    let mockTweetCallback: jest.Mock;

    beforeEach(async () => {
      // Initialize database for tests
      await initDatabase(':memory:');
      
      monitorService = new SocialMonitorService(); // Uses mock client by default
      mockTweetCallback = jest.fn();
      monitorService.setNewTweetCallback(mockTweetCallback);
    });

    afterEach(async () => {
      await monitorService.stopMonitoring();
      await closeDatabase();
    });

    test('should initialize with mock client', () => {
      expect(monitorService.isUsingMockClient()).toBe(true);
      
      const status = monitorService.getMonitoringStatus();
      expect(status.isActive).toBe(false);
      expect(status.monitoredAccounts).toEqual([]);
    });

    test('should start and stop monitoring correctly', async () => {
      await monitorService.startMonitoring();
      
      let status = monitorService.getMonitoringStatus();
      expect(status.isActive).toBe(true);
      
      await monitorService.stopMonitoring();
      
      status = monitorService.getMonitoringStatus();
      expect(status.isActive).toBe(false);
    });

    test('should perform manual user check', async () => {
      const tweets = await monitorService.manualCheckUser('elonmusk');
      
      expect(Array.isArray(tweets)).toBe(true);
      expect(tweets.length).toBeLessThanOrEqual(5);
    });

    test('should add mock tweet for testing', () => {
      const success = monitorService.addMockTweet('elonmusk', 'Testing Bitcoin integration $BTC');
      expect(success).toBe(true);
    });

    test('should update check interval', () => {
      const originalInterval = 5 * 60 * 1000; // 5 minutes
      const newInterval = 2 * 60 * 1000; // 2 minutes
      
      monitorService.setCheckInterval(newInterval);
      // No direct way to verify, but method should not throw
      expect(() => monitorService.setCheckInterval(originalInterval)).not.toThrow();
    });

    test('should handle rate limits gracefully', () => {
      const status = monitorService.getMonitoringStatus();
      
      expect(status.rateLimits).toBeDefined();
      expect(status.rateLimits).toBeInstanceOf(Map);
    });
  });

  describe('Integration Test - Full Tweet Processing Flow', () => {
    test('should process mock tweet through complete pipeline', async () => {
      const mockClient = new TwitterMockClient();
      const monitorService = new SocialMonitorService();
      
      // Set up callback to capture processed tweets
      const processedTweets: Array<{ username: string, tweet: Tweet, user: TwitterUser }> = [];
      monitorService.setNewTweetCallback(async (username, tweet, user) => {
        processedTweets.push({ username, tweet, user });
      });

      // Add a new crypto tweet
      const success = mockClient.addMockTweet('VitalikButerin', 
        'Ethereum 2.0 staking rewards looking great! The network is more secure than ever. $ETH #ethereum #pos'
      );
      expect(success).toBe(true);

      // Manual check should detect and process the new tweet
      const tweets = await monitorService.manualCheckUser('VitalikButerin');
      expect(tweets.length).toBeGreaterThan(0);

      // Verify the tweet would be processed correctly
      const latestTweet = tweets[0];
      const user = await mockClient.getUserByUsername('VitalikButerin');
      expect(user).toBeDefined();

      const analysis = TweetProcessor.analyzeTweet(latestTweet, user!);
      expect(analysis.isRelevant).toBe(true);
      expect(analysis.shouldForward).toBe(true);
      expect(analysis.mentions.symbols).toContain('ETH');

      const formattedMessage = TweetProcessor.formatTweetForTelegram(latestTweet, user!);
      expect(formattedMessage).toContain('**Ethereum**');
      expect(formattedMessage).toContain('**$ETH**');
      expect(formattedMessage).toContain('Vitalik Buterin');
    });
  });
});