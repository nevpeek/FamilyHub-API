CREATE TABLE IF NOT EXISTS meal_week_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meal_week_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  template_id INTEGER NOT NULL,

  day_offset INTEGER NOT NULL
    CHECK (
      day_offset >= 0
      AND day_offset <= 6
    ),

  title TEXT NOT NULL,

  meal_type TEXT NOT NULL
    DEFAULT 'dinner',

  meal_time TEXT,

  description TEXT,

  recipe_url TEXT,

  ingredients TEXT,

  recipe_id INTEGER,

  reminder_enabled INTEGER NOT NULL
    DEFAULT 0,

  reminder_minutes INTEGER,

  created_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (template_id)
    REFERENCES meal_week_templates(id)
    ON DELETE CASCADE,

  FOREIGN KEY (recipe_id)
    REFERENCES recipes(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS meal_week_template_item_members (
  template_item_id INTEGER NOT NULL,
  family_member_id INTEGER NOT NULL,

  PRIMARY KEY (
    template_item_id,
    family_member_id
  ),

  FOREIGN KEY (template_item_id)
    REFERENCES meal_week_template_items(id)
    ON DELETE CASCADE,

  FOREIGN KEY (family_member_id)
    REFERENCES family_members(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
  idx_meal_week_template_items_template
ON meal_week_template_items(template_id);

CREATE INDEX IF NOT EXISTS
  idx_meal_week_template_members_item
ON meal_week_template_item_members(
  template_item_id
);