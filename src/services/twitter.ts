import axios, { AxiosInstance, AxiosResponse } from 'axios';
import logger from '../utils/logger';
import {
  TwitterUser,
  Tweet,
  TwitterApiResponse,
  TwitterRateLimit,
  TwitterSearchParams,
  TwitterError
} from '../types/twitter';

export class TwitterClient {
  private client: AxiosInstance;
  private rateLimiter: Map<string, TwitterRateLimit> = new Map();
  private isConfigured: boolean;

  constructor(bearerToken?: string) {
    this.isConfigured = !!bearerToken;
    
    this.client = axios.create({
      baseURL: 'https://api.twitter.com/2',
      headers: bearerToken ? {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json'
      } : {},
      timeout: 10000
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Response interceptor to track rate limits
    this.client.interceptors.response.use(
      (response: AxiosResponse) => {
        this.updateRateLimit(response);
        return response;
      },
      (error) => {
        if (error.response) {
          this.updateRateLimit(error.response);
          this.handleTwitterError(error.response.data);
        }
        throw error;
      }
    );
  }

  private updateRateLimit(response: AxiosResponse): void {
    const headers = response.headers;
    const endpoint = this.getEndpointFromUrl(response.config?.url || '');
    
    if (headers['x-rate-limit-limit']) {
      const rateLimit: TwitterRateLimit = {
        limit: parseInt(headers['x-rate-limit-limit']),
        remaining: parseInt(headers['x-rate-limit-remaining'] || '0'),
        reset: parseInt(headers['x-rate-limit-reset'] || '0')
      };
      
      this.rateLimiter.set(endpoint, rateLimit);
    }
  }

  private getEndpointFromUrl(url: string): string {
    // Extract endpoint identifier from URL for rate limit tracking
    if (url.includes('/users/by/username')) return 'users_by_username';
    if (url.includes('/users/') && url.includes('/tweets')) return 'user_tweets';
    if (url.includes('/tweets/search')) return 'tweet_search';
    return 'default';
  }

  private handleTwitterError(errorData: any): void {
    if (errorData.errors) {
      const errors = errorData.errors as TwitterError[];
      for (const error of errors) {
        logger.error('Twitter API Error', {
          code: error.code,
          message: error.message,
          type: error.type
        });
      }
    }
  }

  private async checkRateLimit(endpoint: string): Promise<void> {
    if (!this.isConfigured) return;

    const rateLimit = this.rateLimiter.get(endpoint);
    if (!rateLimit) return;

    if (rateLimit.remaining === 0) {
      const resetTime = rateLimit.reset * 1000; // Convert to milliseconds
      const waitTime = resetTime - Date.now();
      
      if (waitTime > 0) {
        logger.warn(`Rate limit exceeded for ${endpoint}, waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  async getUserByUsername(username: string): Promise<TwitterUser | null> {
    if (!this.isConfigured) {
      logger.warn('Twitter client not configured, cannot fetch user');
      return null;
    }

    try {
      await this.checkRateLimit('users_by_username');
      
      const response = await this.client.get<TwitterApiResponse<TwitterUser>>(
        `/users/by/username/${username}`,
        {
          params: {
            'user.fields': 'id,username,name,profile_image_url,public_metrics,verified,description'
          }
        }
      );

      if (response.data.errors) {
        logger.error('Error fetching user', response.data.errors);
        return null;
      }

      return response.data.data || null;
    } catch (error: any) {
      logger.error('Failed to fetch Twitter user', {
        username,
        error: error.message
      });
      return null;
    }
  }

  async getUserTweets(userId: string, maxResults: number = 10): Promise<Tweet[]> {
    if (!this.isConfigured) {
      logger.warn('Twitter client not configured, cannot fetch tweets');
      return [];
    }

    try {
      await this.checkRateLimit('user_tweets');
      
      const response = await this.client.get<TwitterApiResponse<Tweet[]>>(
        `/users/${userId}/tweets`,
        {
          params: {
            max_results: Math.min(maxResults, 100),
            'tweet.fields': 'id,text,author_id,created_at,public_metrics,referenced_tweets,entities,context_annotations',
            'user.fields': 'id,username,name,profile_image_url',
            expansions: 'author_id'
          }
        }
      );

      if (response.data.errors) {
        logger.error('Error fetching user tweets', response.data.errors);
        return [];
      }

      return response.data.data || [];
    } catch (error: any) {
      logger.error('Failed to fetch user tweets', {
        userId,
        error: error.message
      });
      return [];
    }
  }

  async searchTweets(params: TwitterSearchParams): Promise<Tweet[]> {
    if (!this.isConfigured) {
      logger.warn('Twitter client not configured, cannot search tweets');
      return [];
    }

    try {
      await this.checkRateLimit('tweet_search');
      
      const searchParams = {
        query: params.query,
        max_results: Math.min(params.max_results || 10, 100),
        'tweet.fields': params.tweet_fields || 'id,text,author_id,created_at,public_metrics,referenced_tweets,entities,context_annotations',
        'user.fields': params.user_fields || 'id,username,name,profile_image_url,verified',
        expansions: params.expansions || 'author_id',
        ...(params.start_time && { start_time: params.start_time }),
        ...(params.end_time && { end_time: params.end_time }),
        ...(params.next_token && { next_token: params.next_token })
      };

      const response = await this.client.get<TwitterApiResponse<Tweet[]>>(
        '/tweets/search/recent',
        { params: searchParams }
      );

      if (response.data.errors) {
        logger.error('Error searching tweets', response.data.errors);
        return [];
      }

      return response.data.data || [];
    } catch (error: any) {
      logger.error('Failed to search tweets', {
        query: params.query,
        error: error.message
      });
      return [];
    }
  }

  async searchCryptoTweets(maxResults: number = 10): Promise<Tweet[]> {
    const cryptoQuery = '(bitcoin OR btc OR ethereum OR eth OR crypto OR blockchain OR defi OR web3) -is:retweet lang:en';
    
    return this.searchTweets({
      query: cryptoQuery,
      max_results: maxResults,
      tweet_fields: 'id,text,author_id,created_at,public_metrics,entities,context_annotations',
      user_fields: 'id,username,name,profile_image_url,verified',
      expansions: 'author_id'
    });
  }

  getRateLimitStatus(): Map<string, TwitterRateLimit> {
    return new Map(this.rateLimiter);
  }

  isClientConfigured(): boolean {
    return this.isConfigured;
  }
}