CREATE TABLE IF NOT EXISTS weather_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  location_name TEXT NOT NULL DEFAULT 'Gawler, SA',
  latitude REAL NOT NULL DEFAULT -34.6,
  longitude REAL NOT NULL DEFAULT 138.75,
  timezone TEXT NOT NULL DEFAULT 'Australia/Adelaide',
  warnings_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO weather_settings (
  id,
  location_name,
  latitude,
  longitude,
  timezone,
  warnings_enabled
)
VALUES (
  1,
  'Gawler, SA',
  -34.6,
  138.75,
  'Australia/Adelaide',
  1
);