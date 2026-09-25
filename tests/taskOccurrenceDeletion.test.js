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
  "/tasks",
  require("../src/routes/taskRoutes")
);

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  baseUrl =
    `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  db.exec(`
    DELETE FROM family_star_transactions;
    DELETE FROM task_member_completions;
    DELETE FROM task_occurrences;
    DELETE FROM task_rewards;
    DELETE FROM task_members;
    DELETE FROM tasks;
    DELETE FROM family_members;
  `);
});

after(async () => {
  await new Promise((resolve) =>
    server.close(resolve)
  );

  db.close();
});

function createMember() {
  const result = db.prepare(`
    INSERT INTO family_members (
      name,
      colour,
      is_active
    )
    VALUES (
      'Test Member',
      '#3B82F6',
      1
    )
  `).run();

  return Number(result.lastInsertRowid);
}

function createRecurringTask(
  memberId
) {
  const result = db.prepare(`
    INSERT INTO tasks (
      title,
      due_date,
      is_recurring,
      recurrence_rule
    )
    VALUES (
      'Recurring Test Task',
      '2026-09-21',
      1,
      'daily'
    )
  `).run();

  const taskId =
    Number(result.lastInsertRowid);

  db.prepare(`
    INSERT INTO task_members (
      task_id,
      family_member_id
    )
    VALUES (?, ?)
  `).run(
    taskId,
    memberId
  );

  db.prepare(`
    INSERT INTO task_rewards (
      task_id,
      star_value
    )
    VALUES (?, 5)
  `).run(taskId);

  return taskId;
}

function addCompletedOccurrence(
  taskId,
  memberId,
  occurrenceDate
) {
  db.prepare(`
    INSERT INTO task_occurrences (
      task_id,
      occurrence_date,
      is_completed,
      completed_at
    )
    VALUES (
      ?, ?, 1,
      CURRENT_TIMESTAMP
    )
  `).run(
    taskId,
    occurrenceDate
  );

  db.prepare(`
    INSERT INTO task_member_completions (
      task_id,
      family_member_id,
      occurrence_date,
      is_completed,
      completed_at
    )
    VALUES (
      ?, ?, ?, 1,
      CURRENT_TIMESTAMP
    )
  `).run(
    taskId,
    memberId,
    occurrenceDate
  );

  db.prepare(`
    INSERT INTO family_star_transactions (
      family_member_id,
      task_id,
      occurrence_date,
      stars,
      transaction_type,
      description
    )
    VALUES (
      ?, ?, ?, 5,
      'task',
      'Recurring Test Task'
    )
  `).run(
    memberId,
    taskId,
    occurrenceDate
  );
}

function getCompletionCount(
  taskId,
  occurrenceDate
) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM task_member_completions
    WHERE task_id = ?
      AND occurrence_date = ?
  `).get(
    taskId,
    occurrenceDate
  ).count;
}

function getTaskStarCount(
  taskId,
  occurrenceDate
) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM family_star_transactions
    WHERE task_id = ?
      AND occurrence_date = ?
      AND transaction_type = 'task'
  `).get(
    taskId,
    occurrenceDate
  ).count;
}

test(
  "deleting one recurring occurrence removes its completion and task stars",
  async () => {
    const memberId =
      createMember();

    const taskId =
      createRecurringTask(memberId);

    const occurrenceDate =
      "2026-09-23";

    addCompletedOccurrence(
      taskId,
      memberId,
      occurrenceDate
    );

    assert.equal(
      getCompletionCount(
        taskId,
        occurrenceDate
      ),
      1
    );

    assert.equal(
      getTaskStarCount(
        taskId,
        occurrenceDate
      ),
      1
    );

    const response = await fetch(
      `${baseUrl}/tasks/${taskId}/occurrences/${occurrenceDate}`,
      {
        method: "DELETE",
      }
    );

    const data =
      await response.json();

    assert.equal(
      response.status,
      200
    );

    assert.equal(
      data.success,
      true
    );

    const occurrence =
      db.prepare(`
        SELECT
          is_deleted,
          is_completed,
          completed_at
        FROM task_occurrences
        WHERE task_id = ?
          AND occurrence_date = ?
      `).get(
        taskId,
        occurrenceDate
      );

    assert.ok(occurrence);

    assert.equal(
      occurrence.is_deleted,
      1
    );

    assert.equal(
      occurrence.is_completed,
      0
    );

    assert.equal(
      occurrence.completed_at,
      null
    );

    assert.equal(
      getCompletionCount(
        taskId,
        occurrenceDate
      ),
      0
    );

    assert.equal(
      getTaskStarCount(
        taskId,
        occurrenceDate
      ),
      0
    );
  }
);

test(
  "deleting this and future removes future completion and task-star records but preserves earlier history",
  async () => {
    const memberId =
      createMember();

    const taskId =
      createRecurringTask(memberId);

    addCompletedOccurrence(
      taskId,
      memberId,
      "2026-09-22"
    );

    addCompletedOccurrence(
      taskId,
      memberId,
      "2026-09-23"
    );

    addCompletedOccurrence(
      taskId,
      memberId,
      "2026-09-24"
    );

    const response = await fetch(
      `${baseUrl}/tasks/${taskId}/future/2026-09-23`,
      {
        method: "DELETE",
      }
    );

    const data =
      await response.json();

    assert.equal(
      response.status,
      200
    );

    assert.equal(
      data.success,
      true
    );

    const task = db.prepare(`
      SELECT recurrence_end_date
      FROM tasks
      WHERE id = ?
    `).get(taskId);

    assert.equal(
      task.recurrence_end_date,
      "2026-09-22"
    );

    assert.equal(
      getCompletionCount(
        taskId,
        "2026-09-22"
      ),
      1
    );

    assert.equal(
      getTaskStarCount(
        taskId,
        "2026-09-22"
      ),
      1
    );

    assert.equal(
      getCompletionCount(
        taskId,
        "2026-09-23"
      ),
      0
    );

    assert.equal(
      getCompletionCount(
        taskId,
        "2026-09-24"
      ),
      0
    );

    assert.equal(
      getTaskStarCount(
        taskId,
        "2026-09-23"
      ),
      0
    );

    assert.equal(
      getTaskStarCount(
        taskId,
        "2026-09-24"
      ),
      0
    );

    const futureOccurrenceCount =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM task_occurrences
        WHERE task_id = ?
          AND occurrence_date >= ?
      `).get(
        taskId,
        "2026-09-23"
      ).count;

    assert.equal(
      futureOccurrenceCount,
      0
    );
  }
);