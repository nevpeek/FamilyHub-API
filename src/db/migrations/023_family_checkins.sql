CREATE TABLE IF NOT EXISTS family_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_member_id INTEGER NOT NULL,
  checkin_date TEXT NOT NULL,
  mood TEXT NOT NULL CHECK (
    mood IN ('great', 'good', 'okay', 'hard')
  ),
  needs_help INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (family_member_id, checkin_date),
  FOREIGN KEY (family_member_id)
    REFERENCES family_members(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_family_checkins_date
  ON family_checkins(checkin_date);
