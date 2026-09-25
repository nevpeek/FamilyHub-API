ALTER TABLE pantry_items
ADD COLUMN low_stock_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE pantry_items
ADD COLUMN low_stock_threshold REAL DEFAULT NULL;