CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  google_account_id TEXT,
  email TEXT,

  access_token TEXT,
  refresh_token TEXT,
  token_expiry INTEGER,

  scope TEXT,
  token_type TEXT,

  is_enabled INTEGER NOT NULL DEFAULT 1,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_google_calendar_connections_account
ON google_calendar_connections (google_account_id)
WHERE google_account_id IS NOT NULL;