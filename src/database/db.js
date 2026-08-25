const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dataDirectory = path.join(__dirname, "../../data");
const databasePath = path.join(dataDirectory, "familyhub.db");

if (!fs.existsSync(dataDirectory)) {
  fs.mkdirSync(dataDirectory, { recursive: true });
}

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS family_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    colour TEXT NOT NULL DEFAULT '#3B82F6',
    initials TEXT,
    role TEXT DEFAULT 'member',
    is_active INTEGER NOT NULL DEFAULT 1,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

    CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    start_date TEXT NOT NULL,
    start_time TEXT,
    end_date TEXT,
    end_time TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    location TEXT,
    category TEXT DEFAULT 'other',
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurrence_rule TEXT,
    recurrence_end_date TEXT,
    recurrence_count INTEGER,
    recurrence_parent_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS event_members (
    event_id INTEGER NOT NULL,
    family_member_id INTEGER NOT NULL,

    PRIMARY KEY (event_id, family_member_id),

    FOREIGN KEY (event_id)
      REFERENCES events(id)
      ON DELETE CASCADE,

    FOREIGN KEY (family_member_id)
      REFERENCES family_members(id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_events_start_date
    ON events(start_date);

  CREATE INDEX IF NOT EXISTS idx_event_members_member
    ON event_members(family_member_id);
`);

function addColumnIfMissing(tableName, columnName, definition) {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all();

  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`
      ALTER TABLE ${tableName}
      ADD COLUMN ${columnName} ${definition}
    `);
  }
}

addColumnIfMissing("events", "series_id", "INTEGER");
addColumnIfMissing(
  "events",
  "is_recurring",
  "INTEGER NOT NULL DEFAULT 0"
);
addColumnIfMissing("events", "recurrence_rule", "TEXT");
addColumnIfMissing("events", "recurrence_end_date", "TEXT");
addColumnIfMissing("events", "recurrence_count", "INTEGER");
addColumnIfMissing("events", "recurrence_parent_date", "TEXT");

module.exports = db;