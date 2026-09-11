const Database = require("better-sqlite3");

const db = new Database("./data/familyhub.db", {
  readonly: true
});

const columns = db.prepare(`
  PRAGMA table_info(events)
`).all();

console.table(
  columns.map((column) => ({
    name: column.name,
    type: column.type,
    notnull: column.notnull,
    default: column.dflt_value
  }))
);

db.close();