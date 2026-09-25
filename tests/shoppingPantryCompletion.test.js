const {
  test,
  before,
  beforeEach,
  after,
} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const Database = require("better-sqlite3");
const express = require("express");

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

const migrations = path.join(
  __dirname,
  "../src/db/migrations"
);

for (const file of fs
  .readdirSync(migrations)
  .filter((entry) => entry.endsWith(".sql"))
  .sort()) {
  db.exec(
    fs.readFileSync(
      path.join(migrations, file),
      "utf8"
    )
  );
}

const dbModule = require.resolve(
  "../src/database/db"
);
require.cache[dbModule] = {
  id: dbModule,
  filename: dbModule,
  loaded: true,
  exports: db,
};

const app = express();
app.use(express.json());
app.use(
  "/shopping",
  require("../src/routes/shoppingRoutes")
);

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  db.exec(`
    DROP TRIGGER IF EXISTS fail_pantry_insert;
    DROP TRIGGER IF EXISTS fail_shopping_completion;
    DELETE FROM shopping_item_members;
    DELETE FROM shopping_items;
    DELETE FROM pantry_items;
  `);
});

after(async () => {
  await new Promise((resolve) =>
    server.close(resolve)
  );
  db.close();
});

function createShoppingItem({
  name = "Milk",
  quantity = null,
  category = "dairy",
  notes = null,
  completed = false,
} = {}) {
  const result = db
    .prepare(`
      INSERT INTO shopping_items (
        name,
        quantity,
        category,
        notes,
        is_completed,
        completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      name,
      quantity,
      category,
      notes,
      completed ? 1 : 0,
      completed
        ? new Date().toISOString()
        : null
    );

  return Number(result.lastInsertRowid);
}

async function setCompletion(
  id,
  completed,
  restockPantry = true
) {
  const response = await fetch(
    `${baseUrl}/shopping/${id}/completion`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        completed,
        restockPantry,
      }),
    }
  );

  return {
    status: response.status,
    data: await response.json(),
  };
}

function getShoppingItem(id) {
  return db
    .prepare(`
      SELECT *
      FROM shopping_items
      WHERE id = ?
    `)
    .get(id);
}

function getPantryItems() {
  return db
    .prepare(`
      SELECT *
      FROM pantry_items
      ORDER BY id ASC
    `)
    .all();
}

test("completing an incomplete item restocks Pantry exactly once", async () => {
  const id = createShoppingItem();
  const result = await setCompletion(id, true);

  assert.equal(result.status, 200);
  assert.equal(result.data.item.is_completed, true);
  assert.equal(result.data.transitioned, true);
  assert.equal(
    result.data.pantryRestock.applied,
    true
  );
  assert.equal(getShoppingItem(id).is_completed, 1);
  assert.equal(getPantryItems().length, 1);
  assert.equal(getPantryItems()[0].quantity, "1");
});

test("repeating completed true does not restock Pantry again", async () => {
  const id = createShoppingItem();

  assert.equal(
    (await setCompletion(id, true)).status,
    200
  );

  const repeated = await setCompletion(id, true);

  assert.equal(repeated.status, 200);
  assert.equal(repeated.data.transitioned, false);
  assert.equal(
    repeated.data.pantryRestock.applied,
    false
  );
  assert.equal(getPantryItems().length, 1);
  assert.equal(getPantryItems()[0].quantity, "1");
});

test("simultaneous completion requests restock Pantry once", async () => {
  const id = createShoppingItem();
  const results = await Promise.all([
    setCompletion(id, true),
    setCompletion(id, true),
  ]);

  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200]
  );
  assert.equal(
    results.filter(
      (result) =>
        result.data.pantryRestock.applied
    ).length,
    1
  );
  assert.equal(getShoppingItem(id).is_completed, 1);
  assert.equal(getPantryItems().length, 1);
  assert.equal(getPantryItems()[0].quantity, "1");
});

test("an existing Pantry item quantity is incremented", async () => {
  db.prepare(`
    INSERT INTO pantry_items (
      name,
      quantity,
      category
    )
    VALUES (' milk ', '2', 'dairy')
  `).run();

  const id = createShoppingItem({
    name: "MILK",
    quantity: "3",
  });
  const result = await setCompletion(id, true);
  const pantryItems = getPantryItems();

  assert.equal(result.status, 200);
  assert.equal(
    result.data.pantryRestock.created,
    false
  );
  assert.equal(pantryItems.length, 1);
  assert.equal(pantryItems[0].quantity, "5");
});

test("a missing Pantry item is created with existing transfer defaults", async () => {
  const id = createShoppingItem({
    name: "Eggs",
    quantity: "6",
    category: "dairy",
    notes: "Free range",
  });
  const result = await setCompletion(id, true);
  const pantryItem = getPantryItems()[0];

  assert.equal(result.status, 200);
  assert.equal(
    result.data.pantryRestock.created,
    true
  );
  assert.equal(pantryItem.name, "Eggs");
  assert.equal(pantryItem.quantity, "6");
  assert.equal(pantryItem.category, "dairy");
  assert.equal(pantryItem.notes, "Free range");
  assert.equal(pantryItem.is_available, 1);
  assert.equal(pantryItem.low_stock_enabled, 1);
  assert.equal(pantryItem.low_stock_threshold, 1);
  assert.equal(pantryItem.auto_add_to_shopping, 1);
  assert.equal(pantryItem.restock_quantity, "1");
});

test("a Pantry mutation failure leaves Shopping incomplete", async () => {
  const id = createShoppingItem();

  db.exec(`
    CREATE TRIGGER fail_pantry_insert
    BEFORE INSERT ON pantry_items
    BEGIN
      SELECT RAISE(ABORT, 'injected Pantry failure');
    END;
  `);

  const result = await setCompletion(id, true);

  assert.equal(result.status, 500);
  assert.equal(getShoppingItem(id).is_completed, 0);
  assert.equal(getPantryItems().length, 0);
});

test("a Shopping completion failure rolls back the Pantry mutation", async () => {
  const id = createShoppingItem();

  db.prepare(`
    INSERT INTO pantry_items (
      name,
      quantity,
      category
    )
    VALUES ('Milk', '4', 'dairy')
  `).run();

  db.exec(`
    CREATE TRIGGER fail_shopping_completion
    BEFORE UPDATE ON shopping_items
    WHEN NEW.is_completed = 1
    BEGIN
      SELECT RAISE(ABORT, 'injected Shopping failure');
    END;
  `);

  const result = await setCompletion(id, true);

  assert.equal(result.status, 500);
  assert.equal(getShoppingItem(id).is_completed, 0);
  assert.equal(getPantryItems().length, 1);
  assert.equal(getPantryItems()[0].quantity, "4");
});

test("completion can opt out of Pantry restocking", async () => {
  const id = createShoppingItem({
    name: "Bin bags",
    category: "household",
  });
  const result = await setCompletion(
    id,
    true,
    false
  );

  assert.equal(result.status, 200);
  assert.equal(result.data.item.is_completed, true);
  assert.equal(
    result.data.pantryRestock.applied,
    false
  );
  assert.equal(getPantryItems().length, 0);
});

test("marking a completed item incomplete does not alter Pantry", async () => {
  const id = createShoppingItem({
    completed: true,
  });

  db.prepare(`
    INSERT INTO pantry_items (
      name,
      quantity,
      category
    )
    VALUES ('Milk', '4', 'dairy')
  `).run();

  const result = await setCompletion(id, false);

  assert.equal(result.status, 200);
  assert.equal(result.data.item.is_completed, false);
  assert.equal(result.data.item.completed_at, null);
  assert.equal(
    result.data.pantryRestock.applied,
    false
  );
  assert.equal(getPantryItems()[0].quantity, "4");
});
