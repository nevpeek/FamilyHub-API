const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const runMigrations = require("../db/runMigrations");

const dataDirectory = path.join(__dirname, "../../data");
const databasePath = path.join(dataDirectory, "familyhub.db");

if (!fs.existsSync(dataDirectory)) {
  fs.mkdirSync(dataDirectory, { recursive: true });
}

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

runMigrations(db);

module.exports = db;