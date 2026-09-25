CREATE TABLE IF NOT EXISTS food_image_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  search_name TEXT NOT NULL,
  cache_key TEXT NOT NULL UNIQUE,

  image_url TEXT,
  source TEXT,
  matched_product TEXT,
  barcode TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_food_image_cache_search_name
ON food_image_cache(search_name);

CREATE INDEX IF NOT EXISTS idx_food_image_cache_barcode
ON food_image_cache(barcode);