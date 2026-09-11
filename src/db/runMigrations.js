const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "../../data/familyhub.db");
const migrationsPath = path.join(__dirname, "migrations");

const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

db.prepare(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`).run();

const migrationFiles = fs
  .readdirSync(migrationsPath)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const appliedMigrations = new Set(
  db
    .prepare(`
      SELECT filename
      FROM schema_migrations
    `)
    .all()
    .map((row) => row.filename)
);

for (const filename of migrationFiles) {
  if (appliedMigrations.has(filename)) {
    console.log(`Skipping ${filename}`);
    continue;
  }

  const fullPath = path.join(migrationsPath, filename);
  const sql = fs.readFileSync(fullPath, "utf8");

  const runMigration = db.transaction(() => {
    db.exec(sql);

    db.prepare(`
      INSERT INTO schema_migrations (filename)
      VALUES (?)
    `).run(filename);
  });

  console.log(`Applying ${filename}...`);
  runMigration();
  console.log(`Applied ${filename}`);
}

db.close();

console.log("Database migrations complete.");