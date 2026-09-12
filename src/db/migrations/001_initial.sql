-- FamilyHub 2.0
-- Initial database schema
--
-- Creates the original FamilyHub application tables.
-- Later numbered migrations upgrade this schema.
--
-- IMPORTANT:
-- Existing installations that have already recorded
-- 001_initial.sql will not execute this file again.

CREATE TABLE IF NOT EXISTS family_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    colour TEXT NOT NULL DEFAULT '#3B82F6',
    initials TEXT,
    role TEXT DEFAULT 'member',
    photo_url TEXT,
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
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_minutes INTEGER,
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

  CREATE TABLE IF NOT EXISTS event_exceptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    occurrence_date TEXT NOT NULL,
    exception_type TEXT NOT NULL,
    replacement_event_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (event_id, occurrence_date),

    FOREIGN KEY (event_id)
      REFERENCES events(id)
      ON DELETE CASCADE,

    FOREIGN KEY (replacement_event_id)
      REFERENCES events(id)
      ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_event_exceptions_event
    ON event_exceptions(event_id);

  CREATE INDEX IF NOT EXISTS idx_event_exceptions_date
    ON event_exceptions(occurrence_date);


  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT,
    due_time TEXT,
    priority TEXT NOT NULL DEFAULT 'normal',
    category TEXT DEFAULT 'chore',
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_minutes INTEGER,
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurrence_rule TEXT,
    recurrence_end_date TEXT,
    recurrence_count INTEGER,
    is_completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );


  CREATE TABLE IF NOT EXISTS task_members (
    task_id INTEGER NOT NULL,
    family_member_id INTEGER NOT NULL,

    PRIMARY KEY (task_id, family_member_id),

    FOREIGN KEY (task_id)
      REFERENCES tasks(id)
      ON DELETE CASCADE,

    FOREIGN KEY (family_member_id)
      REFERENCES family_members(id)
      ON DELETE CASCADE
  );


  CREATE INDEX IF NOT EXISTS idx_tasks_due_date
    ON tasks(due_date);

  CREATE INDEX IF NOT EXISTS idx_tasks_completed
    ON tasks(is_completed);

  CREATE INDEX IF NOT EXISTS idx_task_members_member
    ON task_members(family_member_id);

    CREATE TABLE IF NOT EXISTS task_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  occurrence_date TEXT NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  title TEXT,
  description TEXT,
  due_time TEXT,
  priority TEXT,
  category TEXT,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  reminder_enabled INTEGER,
  reminder_minutes INTEGER,

  UNIQUE (task_id, occurrence_date),

  FOREIGN KEY (task_id)
    REFERENCES tasks(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_occurrences_task
  ON task_occurrences(task_id);

CREATE INDEX IF NOT EXISTS idx_task_occurrences_date
  ON task_occurrences(occurrence_date);

/* ========================================
   Family Rewards
======================================== */

CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  title TEXT NOT NULL,
  description TEXT,

  star_cost INTEGER NOT NULL DEFAULT 10,

  is_active INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS
  idx_rewards_active
ON rewards (
  is_active
);

/* ========================================
   Family Reward Goals
======================================== */

CREATE TABLE IF NOT EXISTS family_reward_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  family_member_id INTEGER NOT NULL,
  reward_id INTEGER NOT NULL,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (
    family_member_id
  ),

  FOREIGN KEY (family_member_id)
    REFERENCES family_members(id)
    ON DELETE CASCADE,

  FOREIGN KEY (reward_id)
    REFERENCES rewards(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
  idx_family_reward_goals_reward
ON family_reward_goals (
  reward_id
);

/* ========================================
   Task Stars / Rewards
======================================== */

CREATE TABLE IF NOT EXISTS task_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL UNIQUE,
  star_value INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (task_id)
    REFERENCES tasks(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS family_star_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  family_member_id INTEGER NOT NULL,
  task_id INTEGER,
  occurrence_date TEXT NOT NULL DEFAULT '',

  stars INTEGER NOT NULL,

  transaction_type TEXT NOT NULL DEFAULT 'task',

  description TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (family_member_id)
    REFERENCES family_members(id)
    ON DELETE CASCADE,

  FOREIGN KEY (task_id)
    REFERENCES tasks(id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_family_star_task_completion
ON family_star_transactions (
  family_member_id,
  task_id,
  occurrence_date,
  transaction_type
);

CREATE INDEX IF NOT EXISTS
  idx_family_star_member
ON family_star_transactions (
  family_member_id
);

/* ========================================
   Per-Member Task Completion
======================================== */

CREATE TABLE IF NOT EXISTS task_member_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  family_member_id INTEGER NOT NULL,
  occurrence_date TEXT NOT NULL DEFAULT '',
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (
    task_id,
    family_member_id,
    occurrence_date
  ),

  FOREIGN KEY (task_id)
    REFERENCES tasks(id)
    ON DELETE CASCADE,

  FOREIGN KEY (family_member_id)
    REFERENCES family_members(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_member_completions_task
  ON task_member_completions(task_id);

CREATE INDEX IF NOT EXISTS idx_task_member_completions_member
  ON task_member_completions(family_member_id);

CREATE INDEX IF NOT EXISTS idx_task_member_completions_occurrence
  ON task_member_completions(
    task_id,
    occurrence_date
  );


  CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    meal_date TEXT NOT NULL,
    meal_type TEXT NOT NULL DEFAULT 'dinner',
    description TEXT,
    recipe_url TEXT,
    ingredients TEXT,
    recipe_id INTEGER,
    meal_time TEXT,
    reminder_enabled INTEGER NOT NULL DEFAULT 0,
    reminder_minutes INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );


  CREATE TABLE IF NOT EXISTS meal_members (
    meal_id INTEGER NOT NULL,
    family_member_id INTEGER NOT NULL,

    PRIMARY KEY (meal_id, family_member_id),

    FOREIGN KEY (meal_id)
      REFERENCES meals(id)
      ON DELETE CASCADE,

    FOREIGN KEY (family_member_id)
      REFERENCES family_members(id)
      ON DELETE CASCADE
  );


  CREATE INDEX IF NOT EXISTS idx_meals_date
    ON meals(meal_date);

  CREATE INDEX IF NOT EXISTS idx_meals_type
    ON meals(meal_type);

  CREATE INDEX IF NOT EXISTS idx_meal_members_member
    ON meal_members(family_member_id);


  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    ingredients TEXT,
    recipe_url TEXT,
    photo_url TEXT,
    prep_time INTEGER,
    cook_time INTEGER,
    servings INTEGER,
    category TEXT,
    instructions TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_recipes_title
    ON recipes(title);


  CREATE TABLE IF NOT EXISTS shopping_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    notes TEXT,
    is_completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );


  CREATE TABLE IF NOT EXISTS shopping_item_members (
    shopping_item_id INTEGER NOT NULL,
    family_member_id INTEGER NOT NULL,

    PRIMARY KEY (
      shopping_item_id,
      family_member_id
    ),

    FOREIGN KEY (shopping_item_id)
      REFERENCES shopping_items(id)
      ON DELETE CASCADE,

    FOREIGN KEY (family_member_id)
      REFERENCES family_members(id)
      ON DELETE CASCADE
  );


  CREATE INDEX IF NOT EXISTS idx_shopping_items_completed
    ON shopping_items(is_completed);

  CREATE INDEX IF NOT EXISTS idx_shopping_items_category
    ON shopping_items(category);

  CREATE INDEX IF NOT EXISTS idx_shopping_item_members_member
    ON shopping_item_members(family_member_id);


/* ========================================
   Family Lists
======================================== */

CREATE TABLE IF NOT EXISTS family_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT,
  colour TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS
  idx_family_lists_active
ON family_lists (
  is_archived,
  sort_order
);

CREATE TABLE IF NOT EXISTS family_list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  is_completed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (list_id)
    REFERENCES family_lists(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
  idx_family_list_items_list
ON family_list_items (
  list_id,
  is_completed,
  sort_order
);

CREATE TABLE IF NOT EXISTS family_list_item_members (
  list_item_id INTEGER NOT NULL,
  family_member_id INTEGER NOT NULL,

  PRIMARY KEY (
    list_item_id,
    family_member_id
  ),

  FOREIGN KEY (list_item_id)
    REFERENCES family_list_items(id)
    ON DELETE CASCADE,

  FOREIGN KEY (family_member_id)
    REFERENCES family_members(id)
    ON DELETE CASCADE
);


/* ========================================
   Pantry
======================================== */

  CREATE TABLE IF NOT EXISTS pantry_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    notes TEXT,
    is_available INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS meal_wheel_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meal_wheel_group_recipes (
  group_id INTEGER NOT NULL,
  recipe_id INTEGER NOT NULL,

  PRIMARY KEY (
    group_id,
    recipe_id
  ),

  FOREIGN KEY (group_id)
    REFERENCES meal_wheel_groups(id)
    ON DELETE CASCADE,

  FOREIGN KEY (recipe_id)
    REFERENCES recipes(id)
    ON DELETE CASCADE
);

  CREATE INDEX IF NOT EXISTS idx_pantry_items_name
    ON pantry_items(name);

  CREATE INDEX IF NOT EXISTS idx_pantry_items_category
    ON pantry_items(category);

  CREATE INDEX IF NOT EXISTS idx_pantry_items_available
    ON pantry_items(is_available);
