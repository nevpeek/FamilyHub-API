const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const Database = require("better-sqlite3");
const express = require("express");
const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
const migrations = path.join(__dirname, "../src/db/migrations");
for (const file of fs.readdirSync(migrations).filter(f => f.endsWith(".sql")).sort()) {
  db.exec(fs.readFileSync(path.join(migrations, file), "utf8"));
}
const dbModule = require.resolve("../src/database/db");
require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: db };
db.exec("INSERT INTO family_members (id,name) VALUES (1,'One'),(2,'Two'); INSERT INTO recipes (id,title) VALUES (1,'Recipe');");
const app = express();
app.use(express.json());
app.use("/meals", require("../src/routes/mealRoutes"));
app.use("/templates", require("../src/routes/mealTemplateRoutes"));
let server, base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => db.exec("DELETE FROM meals; DELETE FROM meal_week_templates;"));
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
async function call(method, route, body) {
  const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
function payload(date, title = "Dinner", memberIds = [1]) {
  return { title, mealDate: date, mealType: "dinner", mealTime: "18:30", reminderEnabled: true,
    reminderMinutes: 30, recipeId: 1, description: "Keep notes", ingredients: "Rice", recipeUrl: "https://example.test", memberIds };
}
async function create(date, title, memberIds) {
  const result = await call("POST", "/meals", payload(date, title, memberIds));
  assert.equal(result.status, 201); return result.data.meal;
}
async function get(id) { return (await call("GET", `/meals/${id}`)).data.meal; }
function moveBody(source, date, target = null) {
  return { mealId: source.id, sourceRevision: source.revision, targetDate: date, targetType: "dinner",
    expectedTargetId: target?.id ?? null, targetRevision: target?.revision };
}
const selected = meal => ({ id: meal.id, revision: meal.revision });
async function template() {
  const meals = [0, 1].map(dayOffset => ({ ...payload("2026-09-21", `Template ${dayOffset}`), dayOffset }));
  const result = await call("POST", "/templates", { name: "Week", meals });
  assert.equal(result.status, 201); return result.data.template;
}
function content(meal) {
  const { meal_date, meal_type, updated_at, revision, ...rest } = meal;
  return rest;
}

test("move and swap preserve all nonscheduling fields and IDs", async () => {
  const first = await create("2026-09-21", "First");
  const second = await create("2026-09-22", "Second", [2]);
  assert.equal((await call("POST", "/meals/operations/move", moveBody(first, second.meal_date, second))).status, 200);
  assert.equal((await get(first.id)).meal_date, "2026-09-22");
  assert.equal((await get(second.id)).meal_date, "2026-09-21");
  assert.deepEqual(content(await get(first.id)), content(first));
  assert.deepEqual(content(await get(second.id)), content(second));
  const moved = await get(first.id);
  assert.equal((await call("POST", "/meals/operations/move", moveBody(moved, "2026-09-23"))).status, 200);
  assert.deepEqual(content(await get(first.id)), content(first));
});

test("failure on the second swap update restores both dinners and memberships", async () => {
  const first = await create("2026-09-21", "First");
  const second = await create("2026-09-22", "Second", [2]);
  db.exec(`CREATE TRIGGER fail_swap BEFORE UPDATE ON meals WHEN OLD.id = ${first.id}
    BEGIN SELECT RAISE(ABORT, 'injected swap failure'); END;`);
  try {
    assert.equal((await call("POST", "/meals/operations/move", moveBody(first, second.meal_date, second))).status, 500);
    assert.deepEqual(await get(first.id), first);
    assert.deepEqual(await get(second.id), second);
  } finally { db.exec("DROP TRIGGER fail_swap"); }
});

test("hidden destination and stale source/target revisions reject without writes", async () => {
  const first = await create("2026-09-21");
  const second = await create("2026-09-22", "Hidden", [2]);
  assert.equal((await call("POST", "/meals/operations/move", moveBody(first, second.meal_date))).status, 409);
  db.prepare("UPDATE meals SET title='Edited on another device' WHERE id=?").run(second.id);
  assert.equal((await call("POST", "/meals/operations/move", moveBody(first, second.meal_date, second))).status, 409);
  db.prepare("UPDATE meals SET description='New note' WHERE id=?").run(first.id);
  assert.equal((await call("POST", "/meals/operations/move", moveBody(first, "2026-09-23"))).status, 409);
  assert.equal((await get(first.id)).meal_date, first.meal_date);
  assert.equal((await get(second.id)).meal_date, second.meal_date);
});

test("ordinary PUT preserves omitted reminder fields and rejects occupied slots", async () => {
  const first = await create("2026-09-21");
  await create("2026-09-22");
  assert.equal((await call("PUT", `/meals/${first.id}`, { mealDate: "2026-09-22" })).status, 409);
  assert.deepEqual(await get(first.id), first);
  const changed = await call("PUT", `/meals/${first.id}`, { mealDate: "2026-09-23" });
  assert.equal(changed.status, 200);
  assert.deepEqual(content(changed.data.meal), content(first));
  const cleared = await call("PUT", `/meals/${first.id}`, { mealTime: null, reminderEnabled: false, reminderMinutes: null });
  assert.equal(cleared.status, 200); assert.equal(cleared.data.meal.meal_time, null);
});

test("apply-template skips occupied household slots and retry never duplicates meals", async () => {
  const saved = await template();
  const hidden = await create("2026-09-21", "Existing", [2]);
  const request = { templateId: saved.id, weekStart: "2026-09-21" };
  const result = await call("POST", "/meals/operations/apply-template", request);
  assert.equal(result.status, 200);
  assert.equal(result.data.createdMeals.length, 1); assert.equal(result.data.keptMeals.length, 1);
  assert.equal(result.data.createdMeals[0].reminder_enabled, 1);
  assert.equal(result.data.createdMeals[0].meal_time, "18:30");
  assert.deepEqual(await get(hidden.id), hidden);
  const retry = await call("POST", "/meals/operations/apply-template", request);
  assert.equal(retry.status, 200); assert.equal(retry.data.createdMeals.length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meals").get().n, 2);
});

test("apply-template rolls back all inserts when a later insert fails", async () => {
  const saved = await template();
  db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON meals WHEN NEW.title='Template 1' BEGIN SELECT RAISE(ABORT, 'injected'); END;");
  try {
    assert.equal((await call("POST", "/meals/operations/apply-template", { templateId: saved.id, weekStart: "2026-09-21" })).status, 500);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM meals").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM meal_members").get().n, 0);
  } finally { db.exec("DROP TRIGGER fail_insert"); }
});

test("copy-week preserves reminders across a DST week, skips slots and is retry safe", async () => {
  const source = await create("2026-09-28");
  const other = await create("2026-09-29", "Other");
  const occupied = await create("2026-10-06", "Already planned", [2]);
  const request = { weekStart: "2026-10-05", sourceMeals: [selected(source), selected(other)] };
  const result = await call("POST", "/meals/operations/copy-week", request);
  assert.equal(result.status, 200); assert.equal(result.data.createdMeals.length, 1);
  const copied = result.data.createdMeals[0];
  assert.equal(copied.meal_date, "2026-10-05"); assert.equal(copied.meal_time, source.meal_time);
  assert.equal(copied.reminder_enabled, 1); assert.equal(copied.reminder_minutes, 30);
  assert.deepEqual(copied.members, source.members);
  assert.deepEqual(await get(occupied.id), occupied);
  assert.equal((await call("POST", "/meals/operations/copy-week", request)).data.createdMeals.length, 0);
});

test("copy-week database failure and stale source leave the target week untouched", async () => {
  const first = await create("2026-09-14", "First");
  const second = await create("2026-09-15", "Second");
  const request = { weekStart: "2026-09-21", sourceMeals: [selected(first), selected(second)] };
  db.exec("CREATE TRIGGER fail_copy BEFORE INSERT ON meals WHEN NEW.meal_date='2026-09-22' BEGIN SELECT RAISE(ABORT, 'injected'); END;");
  try { assert.equal((await call("POST", "/meals/operations/copy-week", request)).status, 500); }
  finally { db.exec("DROP TRIGGER fail_copy"); }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meals WHERE meal_date >= '2026-09-21'").get().n, 0);
  db.prepare("UPDATE meals SET title='Changed' WHERE id=?").run(second.id);
  assert.equal((await call("POST", "/meals/operations/copy-week", request)).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meals").get().n, 2);
});

test("clear-week failure restores every selected dinner, and success preserves unselected records", async () => {
  const first = await create("2026-09-21");
  const second = await create("2026-09-22");
  const hidden = await create("2026-09-23", "Hidden", [2]);
  const request = { weekStart: "2026-09-21", meals: [selected(first), selected(second)] };
  db.exec(`CREATE TRIGGER fail_clear BEFORE DELETE ON meals WHEN OLD.id=${second.id} BEGIN SELECT RAISE(ABORT, 'injected'); END;`);
  try {
    assert.equal((await call("POST", "/meals/operations/clear-week", request)).status, 500);
    assert.deepEqual(await get(first.id), first); assert.deepEqual(await get(second.id), second);
  } finally { db.exec("DROP TRIGGER fail_clear"); }
  assert.equal((await call("POST", "/meals/operations/clear-week", request)).status, 200);
  assert.deepEqual(await get(hidden.id), hidden);
  const newDinner = await create("2026-09-21", "Added later");
  assert.equal((await call("POST", "/meals/operations/clear-week", request)).status, 200);
  assert.deepEqual(await get(newDinner.id), newDinner);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("clear-week refuses a changed selection rather than deleting part of it", async () => {
  const first = await create("2026-09-21"); const second = await create("2026-09-22");
  db.prepare("UPDATE meals SET meal_date='2026-09-28' WHERE id=?").run(second.id);
  assert.equal((await call("POST", "/meals/operations/clear-week", {
    weekStart: "2026-09-21", meals: [selected(first), selected(second)],
  })).status, 409);
  assert.deepEqual(await get(first.id), first);
});

test("invalid dates and types return 400; simultaneous slot creates produce one dinner", async () => {
  for (const body of [{ ...payload("not-a-date") }, { ...payload("2026-02-30") },
    { ...payload("2026-09-21"), title: 123 }, { ...payload("2026-09-21"), mealType: {} }]) {
    assert.equal((await call("POST", "/meals", body)).status, 400);
  }
  const results = await Promise.all([call("POST", "/meals", payload("2026-09-21")), call("POST", "/meals", payload("2026-09-21"))]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meals").get().n, 1);
});

test("legacy duplicate slots are preserved and moves refuse ambiguous swaps", async () => {
  const first = await create("2026-09-21");
  db.prepare("INSERT INTO meals (title,meal_date,meal_type) VALUES ('Legacy duplicate','2026-09-21','dinner')").run();
  assert.equal((await call("POST", "/meals/operations/move", moveBody(first, "2026-09-22"))).status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meals").get().n, 2);
});
