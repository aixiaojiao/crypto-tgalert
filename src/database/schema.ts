
export interface UserConfig {
  user_id: string;
  created_at: string;
  updated_at: string;
}


export interface PriceAlert {
  id: number;
  user_id: string;
  symbol: string;
  condition: 'above' | 'below' | 'change';
  value: number;
  is_active: boolean;
  created_at: string;
  triggered_at?: string;
}

export interface AlertHistory {
  id: number;
  alert_id: number;
  triggered_at: string;
  price: number;
  message: string;
}

export interface UserFilter {
  id: number;
  user_id: string;
  symbol: string;
  filter_type: 'blacklist' | 'mute' | 'yellowlist';
  expires_at: number | null;
  reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface UserFilterSettings {
  user_id: string;
  volume_threshold: number;
  enable_auto_filter: boolean;
  created_at: number;
  updated_at: number;
}

export const createTables = `
  CREATE TABLE IF NOT EXISTS user_config (
    user_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );


  CREATE TABLE IF NOT EXISTS price_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    condition TEXT NOT NULL CHECK (condition IN ('above', 'below', 'change')),
    value REAL NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    triggered_at TEXT,
    FOREIGN KEY(user_id) REFERENCES user_config(user_id)
  );

  CREATE TABLE IF NOT EXISTS alert_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id INTEGER NOT NULL,
    triggered_at TEXT NOT NULL,
    price REAL NOT NULL,
    message TEXT NOT NULL,
    FOREIGN KEY(alert_id) REFERENCES price_alerts(id)
  );

  CREATE TABLE IF NOT EXISTS user_filters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    filter_type TEXT NOT NULL CHECK (filter_type IN ('blacklist', 'mute', 'yellowlist')),
    expires_at INTEGER NULL,
    reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES user_config(user_id),
    UNIQUE(user_id, symbol, filter_type)
  );

  CREATE TABLE IF NOT EXISTS user_filter_settings (
    user_id TEXT PRIMARY KEY,
    volume_threshold INTEGER DEFAULT 10000000,
    enable_auto_filter BOOLEAN DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES user_config(user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(is_active, symbol);
  CREATE INDEX IF NOT EXISTS idx_alert_history_alert ON alert_history(alert_id);
  CREATE INDEX IF NOT EXISTS idx_user_filters_user ON user_filters(user_id, filter_type);
  CREATE INDEX IF NOT EXISTS idx_user_filters_expires ON user_filters(expires_at);
  CREATE INDEX IF NOT EXISTS idx_user_filters_symbol ON user_filters(symbol);
`;