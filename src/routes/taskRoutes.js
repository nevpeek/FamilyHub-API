const express = require("express");
const db = require("../database/db");

const router = express.Router();

function getTaskById(id) {
  const task = db
    .prepare(`
      SELECT
        id,
        title,
        description,
        due_date,
        due_time,
        priority,
        category,
        is_completed,
        completed_at,
        created_at,
        updated_at
      FROM tasks
      WHERE id = ?
    `)
    .get(id);

  if (!task) {
    return null;
  }

  const members = db
    .prepare(`
      SELECT
        fm.id,
        fm.name,
        fm.colour,
        fm.initials
      FROM task_members tm
      JOIN family_members fm
        ON fm.id = tm.family_member_id
      WHERE tm.task_id = ?
      ORDER BY fm.display_order ASC, fm.name ASC
    `)
    .all(id);

  return {
    ...task,
    is_completed: Boolean(task.is_completed),
    members,
  };
}

function validateMemberIds(memberIds) {
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return {
      valid: false,
      error: "At least one family member is required",
    };
  }

  const uniqueMemberIds = [
    ...new Set(memberIds.map((id) => Number(id))),
  ].filter((id) => Number.isInteger(id) && id > 0);

  if (uniqueMemberIds.length === 0) {
    return {
      valid: false,
      error: "At least one valid family member is required",
    };
  }

  const placeholders = uniqueMemberIds
    .map(() => "?")
    .join(",");

  const rows = db
    .prepare(`
      SELECT id
      FROM family_members
      WHERE id IN (${placeholders})
        AND is_active = 1
    `)
    .all(...uniqueMemberIds);

  if (rows.length !== uniqueMemberIds.length) {
    return {
      valid: false,
      error: "One or more family members are invalid",
    };
  }

  return {
    valid: true,
    memberIds: uniqueMemberIds,
  };
}

router.get("/", (req, res) => {
  const {
    start,
    end,
    memberId,
    completed,
  } = req.query;

  let sql = `
    SELECT DISTINCT
      t.id
    FROM tasks t
    LEFT JOIN task_members tm
      ON tm.task_id = t.id
    WHERE 1 = 1
  `;

  const params = [];

  if (start) {
    sql += `
      AND (
        t.due_date IS NULL
        OR t.due_date >= ?
      )
    `;
    params.push(start);
  }

  if (end) {
    sql += `
      AND (
        t.due_date IS NULL
        OR t.due_date <= ?
      )
    `;
    params.push(end);
  }

  if (memberId) {
    sql += `
      AND tm.family_member_id = ?
    `;
    params.push(Number(memberId));
  }

  if (completed === "true") {
    sql += `
      AND t.is_completed = 1
    `;
  } else if (completed === "false") {
    sql += `
      AND t.is_completed = 0
    `;
  }

  sql += `
    ORDER BY
      CASE
        WHEN t.due_date IS NULL THEN 1
        ELSE 0
      END ASC,
      t.due_date ASC,
      CASE
        WHEN t.due_time IS NULL THEN 1
        ELSE 0
      END ASC,
      t.due_time ASC,
      t.created_at ASC
  `;

  const rows = db
    .prepare(sql)
    .all(...params);

  const tasks = rows
    .map((row) => getTaskById(row.id))
    .filter(Boolean);

  res.json({
    success: true,
    tasks,
  });
});

router.get("/:id", (req, res) => {
  const task = getTaskById(Number(req.params.id));

  if (!task) {
    return res.status(404).json({
      success: false,
      error: "Task not found",
    });
  }

  res.json({
    success: true,
    task,
  });
});

router.post("/", (req, res) => {
  const {
    title,
    description = null,
    dueDate = null,
    dueTime = null,
    priority = "normal",
    category = "chore",
    memberIds = [],
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  const memberValidation =
    validateMemberIds(memberIds);

  if (!memberValidation.valid) {
    return res.status(400).json({
      success: false,
      error: memberValidation.error,
    });
  }

  const createTask = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO tasks (
          title,
          description,
          due_date,
          due_time,
          priority,
          category
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        title.trim(),
        description,
        dueDate,
        dueTime,
        priority,
        category
      );

    const taskId = Number(result.lastInsertRowid);

    const insertMember = db.prepare(`
      INSERT INTO task_members (
        task_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (const memberId of memberValidation.memberIds) {
      insertMember.run(taskId, memberId);
    }

    return taskId;
  });

  const taskId = createTask();

  res.status(201).json({
    success: true,
    task: getTaskById(taskId),
  });
});

router.put("/:id", (req, res) => {
  const taskId = Number(req.params.id);

  const existingTask = getTaskById(taskId);

  if (!existingTask) {
    return res.status(404).json({
      success: false,
      error: "Task not found",
    });
  }

  const {
    title,
    description = null,
    dueDate = null,
    dueTime = null,
    priority = "normal",
    category = "chore",
    memberIds = [],
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  const memberValidation =
    validateMemberIds(memberIds);

  if (!memberValidation.valid) {
    return res.status(400).json({
      success: false,
      error: memberValidation.error,
    });
  }

  const updateTask = db.transaction(() => {
    db.prepare(`
      UPDATE tasks
      SET
        title = ?,
        description = ?,
        due_date = ?,
        due_time = ?,
        priority = ?,
        category = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title.trim(),
      description,
      dueDate,
      dueTime,
      priority,
      category,
      taskId
    );

    db.prepare(`
      DELETE FROM task_members
      WHERE task_id = ?
    `).run(taskId);

    const insertMember = db.prepare(`
      INSERT INTO task_members (
        task_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (const memberId of memberValidation.memberIds) {
      insertMember.run(taskId, memberId);
    }
  });

  updateTask();

  res.json({
    success: true,
    task: getTaskById(taskId),
  });
});

router.patch("/:id/completion", (req, res) => {
  const taskId = Number(req.params.id);
  const completed = Boolean(req.body.completed);

  const existingTask = getTaskById(taskId);

  if (!existingTask) {
    return res.status(404).json({
      success: false,
      error: "Task not found",
    });
  }

  db.prepare(`
    UPDATE tasks
    SET
      is_completed = ?,
      completed_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    completed ? 1 : 0,
    completed ? new Date().toISOString() : null,
    taskId
  );

  res.json({
    success: true,
    task: getTaskById(taskId),
  });
});

router.delete("/:id", (req, res) => {
  const taskId = Number(req.params.id);

  const existingTask = getTaskById(taskId);

  if (!existingTask) {
    return res.status(404).json({
      success: false,
      error: "Task not found",
    });
  }

  db.prepare(`
    DELETE FROM tasks
    WHERE id = ?
  `).run(taskId);

  res.json({
    success: true,
  });
});

module.exports = router;