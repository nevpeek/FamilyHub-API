const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const Database = require("better-sqlite3");
const express = require("express");

// Inject an isolated database before importing the route: never open live data.
const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
const migrationDir = path.join(__dirname, "../src/db/migrations");
for (const file of fs.readdirSync(migrationDir).filter(f => f.endsWith(".sql")).sort()) {
  db.exec(fs.readFileSync(path.join(migrationDir, file), "utf8"));
}
const dbModule = require.resolve("../src/database/db");
require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: db };
db.prepare("INSERT INTO family_members (name) VALUES (?)").run("Test member");
db.prepare("INSERT INTO recipes (title) VALUES (?)").run("Test recipe");
const app = express();
app.use(express.json());
app.use("/templates", require("../src/routes/mealTemplateRoutes"));
let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}/templates`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
});
async function request(method, suffix = "", body) {
  const response = await fetch(base + suffix, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
function plan(name = "Original") {
  return { name, meals: [{ dayOffset: 0, title: "Dinner", mealTime: "18:30",
    description: "Notes", recipeUrl: "https://example.test/recipe", ingredients: "Rice",
    recipeId: 1, reminderEnabled: true, reminderMinutes: 30, memberIds: [1] }] };
}
async function create() {
  const result = await request("POST", "", plan());
  assert.equal(result.status, 201);
  return result.data.template;
}

test("replacement preserves template identity and every dinner field, without changing recipes", async () => {
  const original = await create();
  const recipeBefore = db.prepare("SELECT * FROM recipes").all();
  const replacement = plan("Updated");
  replacement.meals[0].dayOffset = 4;
  const result = await request("PUT", `/${original.id}`, replacement);
  assert.equal(result.status, 200);
  assert.equal(result.data.template.id, original.id);
  assert.equal(result.data.template.created_at, original.created_at);
  assert.equal(result.data.template.name, "Updated");
  const meal = result.data.template.meals[0];
  assert.equal(meal.day_offset, 4);
  assert.equal(meal.title, "Dinner");
  assert.equal(meal.meal_time, "18:30");
  assert.equal(meal.description, "Notes");
  assert.equal(meal.recipe_url, "https://example.test/recipe");
  assert.equal(meal.ingredients, "Rice");
  assert.equal(meal.recipe_id, 1);
  assert.equal(meal.reminder_enabled, 1);
  assert.equal(meal.reminder_minutes, 30);
  assert.deepEqual(meal.members.map(m => m.id), [1]);
  assert.deepEqual(db.prepare("SELECT * FROM recipes").all(), recipeBefore);
  assert.equal((await request("GET", `/${original.id}`)).data.template.meals.length, 1);
  assert.equal((await request("GET")).data.templates.filter(t => t.id === original.id).length, 1);
  // A response-loss retry replaces the same template, rather than making another.
  assert.equal((await request("PUT", `/${original.id}`, replacement)).status, 200);
  assert.equal((await request("GET", `/${original.id}`)).data.template.meals.length, 1);
});

test("invalid replacement leaves the original and member links exactly intact", async () => {
  const original = await create();
  for (const mutate of [
    p => { p.name = " "; }, p => { p.meals = []; },
    p => { p.meals.push(null); }, p => { p.meals[0].dayOffset = 7; },
    p => { p.meals[0].title = 123; }, p => { p.meals[0].mealTime = "25:00"; },
    p => { p.meals[0].recipeId = 99999; }, p => { p.meals[0].memberIds = [99999]; },
  ]) {
    const replacement = plan("Invalid"); mutate(replacement);
    assert.equal((await request("PUT", `/${original.id}`, replacement)).status, 400);
    assert.deepEqual((await request("GET", `/${original.id}`)).data.template, original);
  }
});

test("database failure after deleting old items and inserting a new item rolls everything back", async () => {
  const original = await create();
  db.exec(`CREATE TRIGGER fail_second_dinner BEFORE INSERT ON meal_week_template_items
    WHEN NEW.title = 'Injected failure' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
  try {
    const replacement = plan("Must roll back");
    replacement.meals.push({ ...replacement.meals[0], dayOffset: 2, title: "Injected failure" });
    assert.equal((await request("PUT", `/${original.id}`, replacement)).status, 500);
    assert.deepEqual((await request("GET", `/${original.id}`)).data.template, original);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally { db.exec("DROP TRIGGER fail_second_dinner"); }
});

test("member-link failure also rolls back the complete replacement", async () => {
  const original = await create();
  db.exec(`CREATE TRIGGER fail_member BEFORE INSERT ON meal_week_template_item_members
    BEGIN SELECT RAISE(ABORT, 'test member failure'); END;`);
  try {
    assert.equal((await request("PUT", `/${original.id}`, plan("Must roll back"))).status, 500);
    assert.deepEqual((await request("GET", `/${original.id}`)).data.template, original);
  } finally { db.exec("DROP TRIGGER fail_member"); }
});

test("missing and invalid IDs never create templates; delete still removes child rows", async () => {
  const beforeCount = db.prepare("SELECT COUNT(*) AS n FROM meal_week_templates").get().n;
  assert.equal((await request("PUT", "/999999", plan())).status, 404);
  assert.equal((await request("PUT", "/not-an-id", plan())).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meal_week_templates").get().n, beforeCount);
  const original = await create();
  assert.equal((await request("DELETE", `/${original.id}`)).status, 200);
  assert.equal((await request("GET", `/${original.id}`)).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM meal_week_template_items WHERE template_id = ?").get(original.id).n, 0);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});
