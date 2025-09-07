export interface TwitterUser {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
  verified?: boolean;
  description?: string;
}

export interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    like_count: number;
    reply_count: number;
    quote_count: number;
  };
  referenced_tweets?: {
    type: 'replied_to' | 'quoted' | 'retweeted';
    id: string;
  }[];
  entities?: {
    hashtags?: { tag: string }[];
    urls?: { expanded_url: string; display_url: string }[];
    mentions?: { username: string }[];
    cashtags?: { tag: string }[];
  };
  context_annotations?: {
    domain: {
      id: string;
      name: string;
      description: string;
    };
    entity: {
      id: string;
      name: string;
      description?: string;
    };
  }[];
}

export interface TwitterApiResponse<T> {
  data?: T;
  meta?: {
    result_count: number;
    next_token?: string;
    previous_token?: string;
  };
  errors?: TwitterError[];
  includes?: {
    users?: TwitterUser[];
    tweets?: Tweet[];
  };
}

export interface TwitterError {
  code: number;
  message: string;
  resource_type?: string;
  field?: string;
  parameter?: string;
  resource_id?: string;
  type?: string;
  title?: string;
  detail?: string;
}

export interface TwitterRateLimit {
  limit: number;
  remaining: number;
  reset: number;
}

export interface TwitterSearchParams {
  query: string;
  max_results?: number;
  start_time?: string;
  end_time?: string;
  tweet_fields?: string;
  user_fields?: string;
  expansions?: string;
  next_token?: string;
}

export interface TweetMonitorState {
  username: string;
  lastTweetId?: string;
  lastChecked: Date;
  isActive: boolean;
}

export interface CryptoKeywords {
  primary: string[];
  secondary: string[];
  exchanges: string[];
  symbols: string[];
}