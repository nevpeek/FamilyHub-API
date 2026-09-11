CREATE TABLE IF NOT EXISTS calendar_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL,

  source_type TEXT NOT NULL DEFAULT 'ics',

  source_url TEXT,

  colour TEXT,

  is_enabled INTEGER NOT NULL DEFAULT 1,

  sync_interval_minutes INTEGER NOT NULL DEFAULT 60,

  last_synced_at TEXT,

  last_sync_status TEXT,

  last_sync_error TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS
  idx_calendar_sources_type
ON calendar_sources(source_type);

CREATE INDEX IF NOT EXISTS
  idx_calendar_sources_enabled
ON calendar_sources(is_enabled);