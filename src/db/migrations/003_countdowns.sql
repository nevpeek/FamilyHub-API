CREATE TABLE IF NOT EXISTS countdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  title TEXT NOT NULL,

  target_date TEXT NOT NULL,

  target_time TEXT,

  description TEXT,

  category TEXT DEFAULT 'other',

  colour TEXT,

  event_id INTEGER,

  family_member_id INTEGER,

  is_automatic INTEGER NOT NULL DEFAULT 0,

  is_active INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (event_id)
    REFERENCES events(id)
    ON DELETE SET NULL,

  FOREIGN KEY (family_member_id)
    REFERENCES family_members(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_countdowns_target_date
ON countdowns(target_date);

CREATE INDEX IF NOT EXISTS idx_countdowns_event_id
ON countdowns(event_id);

CREATE INDEX IF NOT EXISTS idx_countdowns_family_member_id
ON countdowns(family_member_id);