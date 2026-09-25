CREATE TABLE IF NOT EXISTS fresh_food_image_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  canonical_name TEXT NOT NULL UNIQUE,

  image_url TEXT NOT NULL,

  source TEXT NOT NULL DEFAULT 'familyhub-fresh-library',

  matched_product TEXT,

  rotation INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fresh_food_image_library_canonical_name
ON fresh_food_image_library(canonical_name);