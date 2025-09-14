
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

  CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(is_active, symbol);
  CREATE INDEX IF NOT EXISTS idx_alert_history_alert ON alert_history(alert_id);
`;