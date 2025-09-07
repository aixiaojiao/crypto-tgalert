import { TwitterClient } from './twitter';
import { TwitterMockClient } from './twitterMock';
import { TweetProcessor } from './tweetProcessor';
import { TwitterFollowModel } from '../models/TwitterFollow';
import { TwitterUser, Tweet, TweetMonitorState } from '../types/twitter';
import logger from '../utils/logger';

export class SocialMonitorService {
  private twitter: TwitterClient | TwitterMockClient;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private monitorStates: Map<string, TweetMonitorState> = new Map();
  private isMonitoring: boolean = false;
  private checkInterval: number = 5 * 60 * 1000; // 5 minutes
  private onNewTweetCallback?: (username: string, tweet: Tweet, user: TwitterUser) => Promise<void>;

  constructor(bearerToken?: string) {
    // Use mock client if no bearer token provided or if explicitly using mock
    if (!bearerToken || process.env.NODE_ENV === 'development') {
      this.twitter = new TwitterMockClient();
      logger.info('SocialMonitorService: Using mock Twitter client');
    } else {
      this.twitter = new TwitterClient(bearerToken);
      logger.info('SocialMonitorService: Using real Twitter API client');
    }
  }

  setNewTweetCallback(callback: (username: string, tweet: Tweet, user: TwitterUser) => Promise<void>): void {
    this.onNewTweetCallback = callback;
  }

  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      logger.warn('Social monitoring is already active');
      return;
    }

    try {
      logger.info('Starting social monitoring service...');
      
      // Load all followed accounts from database
      const follows = await TwitterFollowModel.getAllFollows();
      logger.info(`Found ${follows.length} accounts to monitor`);

      // Initialize monitoring state for each followed account
      for (const follow of follows) {
        await this.initializeMonitorState(follow.twitter_username);
      }

      // Start monitoring intervals
      this.isMonitoring = true;
      await this.startMonitoringIntervals();
      
      logger.info(`Social monitoring started for ${follows.length} accounts`);
    } catch (error) {
      logger.error('Failed to start social monitoring', error);
      throw error;
    }
  }

  async stopMonitoring(): Promise<void> {
    if (!this.isMonitoring) {
      logger.warn('Social monitoring is not active');
      return;
    }

    logger.info('Stopping social monitoring service...');
    
    // Clear all intervals
    this.monitoringIntervals.forEach((interval, username) => {
      clearInterval(interval);
      logger.debug(`Stopped monitoring interval for @${username}`);
    });
    
    this.monitoringIntervals.clear();
    this.isMonitoring = false;
    
    logger.info('Social monitoring stopped');
  }

  async followUser(userId: string, username: string): Promise<boolean> {
    try {
      // Verify Twitter user exists
      const user = await this.twitter.getUserByUsername(username);
      if (!user) {
        logger.warn(`Twitter user @${username} not found`);
        return false;
      }

      // Add to database
      await TwitterFollowModel.addFollow(userId, username);
      
      // Initialize monitoring if service is running
      if (this.isMonitoring) {
        await this.initializeMonitorState(username);
        this.startIndividualMonitoring(username);
      }

      logger.info(`Successfully following @${username} for user ${userId}`);
      return true;
    } catch (error: any) {
      logger.error(`Failed to follow @${username}`, error);
      throw error;
    }
  }

  async unfollowUser(userId: string, username: string): Promise<boolean> {
    try {
      const success = await TwitterFollowModel.removeFollow(userId, username);
      
      if (success) {
        // Stop monitoring this user
        const interval = this.monitoringIntervals.get(username);
        if (interval) {
          clearInterval(interval);
          this.monitoringIntervals.delete(username);
        }
        
        this.monitorStates.delete(username);
        logger.info(`Successfully unfollowed @${username} for user ${userId}`);
      }

      return success;
    } catch (error) {
      logger.error(`Failed to unfollow @${username}`, error);
      return false;
    }
  }

  private async initializeMonitorState(username: string): Promise<void> {
    try {
      const user = await this.twitter.getUserByUsername(username);
      if (!user) {
        logger.warn(`Cannot initialize monitoring for @${username} - user not found`);
        return;
      }

      // Get latest tweets to establish baseline
      const tweets = await this.twitter.getUserTweets(user.id, 1);
      const lastTweetId = tweets.length > 0 ? tweets[0].id : undefined;

      const state: TweetMonitorState = {
        username,
        ...(lastTweetId && { lastTweetId }),
        lastChecked: new Date(),
        isActive: true
      };

      this.monitorStates.set(username, state);
      logger.debug(`Initialized monitoring state for @${username}`, { lastTweetId });
    } catch (error) {
      logger.error(`Failed to initialize monitor state for @${username}`, error);
    }
  }

  private async startMonitoringIntervals(): Promise<void> {
    // Start individual monitoring for each account
    const usernames = Array.from(this.monitorStates.keys());
    
    for (const username of usernames) {
      this.startIndividualMonitoring(username);
    }
  }

  private startIndividualMonitoring(username: string): void {
    // Clear existing interval if any
    const existingInterval = this.monitoringIntervals.get(username);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Create new monitoring interval
    const interval = setInterval(async () => {
      await this.checkForNewTweets(username);
    }, this.checkInterval);

    this.monitoringIntervals.set(username, interval);
    logger.debug(`Started monitoring interval for @${username}`);
  }

  private async checkForNewTweets(username: string): Promise<void> {
    const state = this.monitorStates.get(username);
    if (!state || !state.isActive) {
      return;
    }

    try {
      let newTweets: Tweet[] = [];
      
      // Use different methods for mock vs real client
      if (this.twitter instanceof TwitterMockClient) {
        newTweets = await this.twitter.getNewTweetsForUser(username);
      } else {
        // For real Twitter client, get recent tweets and filter new ones
        const user = await this.twitter.getUserByUsername(username);
        if (!user) return;

        const recentTweets = await this.twitter.getUserTweets(user.id, 10);
        if (state.lastTweetId) {
          const lastSeenIndex = recentTweets.findIndex(tweet => tweet.id === state.lastTweetId);
          newTweets = lastSeenIndex === -1 ? recentTweets : recentTweets.slice(0, lastSeenIndex);
        } else {
          // First time checking, only take the latest tweet
          newTweets = recentTweets.slice(0, 1);
        }
      }

      if (newTweets.length > 0) {
        logger.info(`Found ${newTweets.length} new tweets from @${username}`);
        
        // Process each new tweet
        for (const tweet of newTweets.reverse()) { // Process oldest first
          await this.processNewTweet(username, tweet);
        }

        // Update monitoring state
        state.lastTweetId = newTweets[newTweets.length - 1].id;
        state.lastChecked = new Date();
      }

    } catch (error) {
      logger.error(`Error checking tweets for @${username}`, error);
    }
  }

  private async processNewTweet(username: string, tweet: Tweet): Promise<void> {
    try {
      const user = await this.twitter.getUserByUsername(username);
      if (!user) return;

      // Check if tweet should be forwarded to Telegram
      const shouldForward = TweetProcessor.shouldForwardToTelegram(tweet, user);
      
      if (shouldForward) {
        logger.info(`Processing crypto-relevant tweet from @${username}`, {
          tweetId: tweet.id,
          relevanceScore: TweetProcessor.calculateRelevanceScore(tweet)
        });

        // Call the callback if provided
        if (this.onNewTweetCallback) {
          await this.onNewTweetCallback(username, tweet, user);
        }
      } else {
        logger.debug(`Skipping non-crypto tweet from @${username}`, {
          tweetId: tweet.id,
          text: tweet.text.substring(0, 50) + '...'
        });
      }
    } catch (error) {
      logger.error(`Error processing tweet ${tweet.id} from @${username}`, error);
    }
  }

  // Manual check for new tweets (useful for testing)
  async manualCheckUser(username: string): Promise<Tweet[]> {
    logger.info(`Manual check for new tweets from @${username}`);
    
    const state = this.monitorStates.get(username);
    if (!state) {
      await this.initializeMonitorState(username);
    }

    await this.checkForNewTweets(username);
    
    // Return recent tweets for verification
    const user = await this.twitter.getUserByUsername(username);
    if (!user) return [];

    return this.twitter.getUserTweets(user.id, 5);
  }

  // Get monitoring status
  getMonitoringStatus(): {
    isActive: boolean;
    monitoredAccounts: string[];
    states: Map<string, TweetMonitorState>;
    rateLimits?: Map<string, any>;
  } {
    return {
      isActive: this.isMonitoring,
      monitoredAccounts: Array.from(this.monitorStates.keys()),
      states: new Map(this.monitorStates),
      rateLimits: this.twitter.getRateLimitStatus()
    };
  }

  // Add mock tweet (for testing with mock client)
  addMockTweet(username: string, tweetText: string): boolean {
    if (this.twitter instanceof TwitterMockClient) {
      return this.twitter.addMockTweet(username, tweetText);
    }
    logger.warn('addMockTweet only works with mock client');
    return false;
  }

  // Update check interval
  setCheckInterval(intervalMs: number): void {
    this.checkInterval = intervalMs;
    logger.info(`Updated check interval to ${intervalMs}ms`);
    
    // Restart intervals if monitoring is active
    if (this.isMonitoring) {
      this.monitoringIntervals.forEach((interval, username) => {
        clearInterval(interval);
        this.startIndividualMonitoring(username);
      });
    }
  }

  isUsingMockClient(): boolean {
    return this.twitter instanceof TwitterMockClient;
  }
}