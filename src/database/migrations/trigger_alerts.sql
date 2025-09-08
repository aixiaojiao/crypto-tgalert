-- Create table for storing rankings history
CREATE TABLE IF NOT EXISTS gainers_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  position INTEGER NOT NULL,
  price_change_percent REAL NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS funding_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  position INTEGER NOT NULL,
  funding_rate REAL NOT NULL,
  funding_rate_8h REAL NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create table for trigger alert settings
CREATE TABLE IF NOT EXISTS trigger_alert_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  alert_type TEXT NOT NULL, -- 'gainers' or 'funding'
  is_enabled INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, alert_type)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_gainers_timestamp ON gainers_rankings(timestamp);
CREATE INDEX IF NOT EXISTS idx_funding_timestamp ON funding_rankings(timestamp);
CREATE INDEX IF NOT EXISTS idx_trigger_settings_user ON trigger_alert_settings(user_id, alert_type);