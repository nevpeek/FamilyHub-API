const express = require("express");
const db = require("../database/db");

const router = express.Router();

function parseDateKey(dateKey) {
  const [year, month, day] =
    String(dateKey)
      .split("-")
      .map(Number);

  return new Date(
    year,
    month - 1,
    day,
    12,
    0,
    0,
    0
  );
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");
  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addRecurrenceStep(
  date,
  recurrenceRule
) {
  const next = new Date(date);

  if (recurrenceRule === "daily") {
    next.setDate(
      next.getDate() + 1
    );

    return next;
  }

  if (recurrenceRule === "weekly") {
    next.setDate(
      next.getDate() + 7
    );

    return next;
  }

  if (recurrenceRule === "monthly") {
    next.setMonth(
      next.getMonth() + 1
    );

    return next;
  }

  return null;
}

function getOccurrenceState(
  taskId,
  occurrenceDate
) {
  const row = db
    .prepare(`
      SELECT
        is_completed,
        completed_at,
        title,
        description,
        due_time,
        priority,
        category,
        is_deleted
      FROM task_occurrences
      WHERE task_id = ?
        AND occurrence_date = ?
    `)
    .get(
      taskId,
      occurrenceDate
    );

  if (!row) {
    return {
      is_completed: false,
      completed_at: null,
      title: null,
      description: null,
      due_time: null,
      priority: null,
      category: null,
      is_deleted: false,
    };
  }

  return {
    is_completed:
      Boolean(row.is_completed),

    completed_at:
      row.completed_at || null,

    title:
      row.title ?? null,

    description:
      row.description ?? null,

    due_time:
      row.due_time ?? null,

    priority:
      row.priority ?? null,

    category:
      row.category ?? null,

    is_deleted:
      Boolean(row.is_deleted),
  };
}

function expandRecurringTask(
  task,
  startDate,
  endDate
) {
  if (
    !task.is_recurring ||
    !task.recurrence_rule ||
    !task.due_date
  ) {
    return [];
  }

  const occurrences = [];

  let occurrenceDate =
    parseDateKey(task.due_date);

  const rangeStart =
    startDate
      ? parseDateKey(startDate)
      : null;

  const rangeEnd =
    endDate
      ? parseDateKey(endDate)
      : null;

  const recurrenceEnd =
    task.recurrence_end_date
      ? parseDateKey(
          task.recurrence_end_date
        )
      : null;

  const maxCount =
    task.recurrence_count
      ? Number(
          task.recurrence_count
        )
      : null;

  let generatedCount = 0;

  while (occurrenceDate) {
    if (
      recurrenceEnd &&
      occurrenceDate > recurrenceEnd
    ) {
      break;
    }

    if (
      maxCount &&
      generatedCount >= maxCount
    ) {
      break;
    }

    if (
      rangeEnd &&
      occurrenceDate > rangeEnd
    ) {
      break;
    }

    generatedCount += 1;

    const occurrenceKey =
      formatDateKey(
        occurrenceDate
      );

    const inRange =
      (!rangeStart ||
        occurrenceDate >=
          rangeStart) &&
      (!rangeEnd ||
        occurrenceDate <=
          rangeEnd);

if (inRange) {
  const occurrenceState =
    getOccurrenceState(
      task.id,
      occurrenceKey
    );

  if (!occurrenceState.is_deleted) {
    occurrences.push({
      ...task,

      title:
        occurrenceState.title ??
        task.title,

      description:
        occurrenceState.description ??
        task.description,

      due_date:
        occurrenceKey,

      due_time:
        occurrenceState.due_time ??
        task.due_time,

      priority:
        occurrenceState.priority ??
        task.priority,

      category:
        occurrenceState.category ??
        task.category,

      is_completed:
        occurrenceState.is_completed,

      completed_at:
        occurrenceState.completed_at,

      is_occurrence: true,

      occurrence_date:
        occurrenceKey,

      occurrence_key:
        `${task.id}:${occurrenceKey}`,
    });
  }
}

    occurrenceDate =
      addRecurrenceStep(
        occurrenceDate,
        task.recurrence_rule
      );
  }

  return occurrences;
}

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
  is_recurring,
  recurrence_rule,
  recurrence_end_date,
  recurrence_count,
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
  is_recurring: Boolean(task.is_recurring),
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
    AND (
      t.is_recurring = 1
      OR t.is_completed = 1
    )
  `;
} else if (completed === "false") {
  sql += `
    AND (
      t.is_recurring = 1
      OR t.is_completed = 0
    )
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

  const baseTasks = rows
  .map((row) =>
    getTaskById(row.id)
  )
  .filter(Boolean);

const tasks = [];

for (const task of baseTasks) {
  if (task.is_recurring) {
    const occurrences =
      expandRecurringTask(
        task,
        start,
        end
      );

    for (
      const occurrence of occurrences
    ) {
      if (
        completed === "true" &&
        !occurrence.is_completed
      ) {
        continue;
      }

      if (
        completed === "false" &&
        occurrence.is_completed
      ) {
        continue;
      }

      tasks.push(occurrence);
    }

    continue;
  }

  tasks.push(task);
}

tasks.sort((a, b) => {
  if (!a.due_date && !b.due_date) {
    return 0;
  }

  if (!a.due_date) {
    return 1;
  }

  if (!b.due_date) {
    return -1;
  }

  const dateCompare =
    a.due_date.localeCompare(
      b.due_date
    );

  if (dateCompare !== 0) {
    return dateCompare;
  }

  if (!a.due_time && !b.due_time) {
    return 0;
  }

  if (!a.due_time) {
    return 1;
  }

  if (!b.due_time) {
    return -1;
  }

  return a.due_time.localeCompare(
    b.due_time
  );
});

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
    isRecurring = false,
    recurrenceRule = null,
    recurrenceEndDate = null,
    recurrenceCount = null,
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
          category,
          is_recurring,
          recurrence_rule,
          recurrence_end_date,
          recurrence_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        title.trim(),
        description,
        dueDate,
        dueTime,
        priority,
        category,
        isRecurring ? 1 : 0,
        isRecurring ? recurrenceRule : null,
        isRecurring ? recurrenceEndDate : null,
        isRecurring &&
          recurrenceCount !== null
          ? Number(recurrenceCount)
          : null
      );

    const taskId =
      Number(result.lastInsertRowid);

    const insertMember = db.prepare(`
      INSERT INTO task_members (
        task_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (
      const memberId of
      memberValidation.memberIds
    ) {
      insertMember.run(
        taskId,
        memberId
      );
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
  isRecurring = false,
  recurrenceRule = null,
  recurrenceEndDate = null,
  recurrenceCount = null,
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
is_recurring = ?,
recurrence_rule = ?,
recurrence_end_date = ?,
recurrence_count = ?,
updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .run(
  title.trim(),
  description,
  dueDate,
  dueTime,
  priority,
  category,
  isRecurring ? 1 : 0,
  isRecurring ? recurrenceRule : null,
  isRecurring ? recurrenceEndDate : null,
  isRecurring && recurrenceCount !== null
    ? Number(recurrenceCount)
    : null,
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

router.put("/:id/occurrences/:occurrenceDate", (req, res) => {
  const taskId = Number(req.params.id);
  const occurrenceDate =
    req.params.occurrenceDate;

  const existingTask =
    getTaskById(taskId);

  if (!existingTask) {
    return res.status(404).json({
      success: false,
      error: "Task not found",
    });
  }

  if (!existingTask.is_recurring) {
    return res.status(400).json({
      success: false,
      error:
        "Task is not part of a recurring series",
    });
  }

  const {
    title,
    description = null,
    dueTime = null,
    priority = "normal",
    category = "chore",
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  db.prepare(`
    INSERT INTO task_occurrences (
      task_id,
      occurrence_date,
      title,
      description,
      due_time,
      priority,
      category,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

    ON CONFLICT (
      task_id,
      occurrence_date
    )
    DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      due_time = excluded.due_time,
      priority = excluded.priority,
      category = excluded.category,
      is_deleted = 0,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    taskId,
    occurrenceDate,
    title.trim(),
    description,
    dueTime,
    priority,
    category
  );

  const occurrenceState =
    getOccurrenceState(
      taskId,
      occurrenceDate
    );

  res.json({
    success: true,
    task: {
      ...existingTask,

      title:
        occurrenceState.title ??
        existingTask.title,

      description:
        occurrenceState.description ??
        existingTask.description,

      due_date:
        occurrenceDate,

      due_time:
        occurrenceState.due_time ??
        existingTask.due_time,

      priority:
        occurrenceState.priority ??
        existingTask.priority,

      category:
        occurrenceState.category ??
        existingTask.category,

      is_completed:
        occurrenceState.is_completed,

      completed_at:
        occurrenceState.completed_at,

      is_occurrence: true,

      occurrence_date:
        occurrenceDate,

      occurrence_key:
        `${taskId}:${occurrenceDate}`,
    },
  });
});

router.put("/:id/future/:occurrenceDate", (req, res) => {
  const taskId = Number(req.params.id);
  const occurrenceDate =
    req.params.occurrenceDate;

  const existingTask =
    getTaskById(taskId);

  if (!existingTask) {
    return res.status(404).json({
      success: false,
      error: "Task not found",
    });
  }

  if (!existingTask.is_recurring) {
    return res.status(400).json({
      success: false,
      error:
        "Task is not part of a recurring series",
    });
  }

  const {
    title,
    description = null,
    dueTime = null,
    priority = "normal",
    category = "chore",
    memberIds = [],
    recurrenceRule = null,
    recurrenceEndDate = null,
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  const newRecurrenceRule =
    recurrenceRule ||
    existingTask.recurrence_rule;

  const originalEndDate =
    existingTask.recurrence_end_date;

  const previousDate = new Date(
    `${occurrenceDate}T12:00:00`
  );

  previousDate.setDate(
    previousDate.getDate() - 1
  );

  const previousDateKey =
    formatDateKey(previousDate);

  const transaction =
    db.transaction(() => {
      /*
       * End the original series immediately
       * before the selected occurrence.
       */
      db.prepare(`
        UPDATE tasks
        SET
          recurrence_end_date = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        previousDateKey,
        taskId
      );

      /*
       * Create the new series beginning on
       * the selected occurrence.
       */
      const result =
        db.prepare(`
          INSERT INTO tasks (
            title,
            description,
            due_date,
            due_time,
            priority,
            category,
            is_completed,
            is_recurring,
            recurrence_rule,
            recurrence_end_date,
            recurrence_count
          )
          VALUES (
            ?, ?, ?, ?, ?, ?,
            0, 1, ?, ?, NULL
          )
        `).run(
          title.trim(),
          description,
          occurrenceDate,
          dueTime,
          priority,
          category,
          newRecurrenceRule,
          recurrenceEndDate ||
            originalEndDate ||
            null
        );

      const newTaskId =
        Number(result.lastInsertRowid);

      /*
       * Copy selected family members.
       */
      const memberInsert =
        db.prepare(`
          INSERT INTO task_members (
            task_id,
            family_member_id
          )
          VALUES (?, ?)
        `);

      const membersToUse =
        Array.isArray(memberIds) &&
        memberIds.length > 0
          ? memberIds
          : existingTask.members.map(
              (member) => member.id
            );

      for (const memberId of membersToUse) {
        memberInsert.run(
          newTaskId,
          Number(memberId)
        );
      }

      return newTaskId;
    });

  try {
    const newTaskId =
      transaction();

    const newTask =
      getTaskById(newTaskId);

    return res.json({
      success: true,
      old_task_id: taskId,
      new_task_id: newTaskId,
      task: newTask,
    });
  } catch (error) {
    console.error(
      "Failed to split recurring task:",
      error
    );

    return res.status(500).json({
      success: false,
      error:
        "Failed to update this and future tasks",
    });
  }
});

router.delete(
  "/:id/occurrences/:occurrenceDate",
  (req, res) => {
    const taskId =
      Number(req.params.id);

    const occurrenceDate =
      req.params.occurrenceDate;

    const existingTask =
      getTaskById(taskId);

    if (!existingTask) {
      return res.status(404).json({
        success: false,
        error: "Task not found",
      });
    }

    if (!existingTask.is_recurring) {
      return res.status(400).json({
        success: false,
        error:
          "Task is not part of a recurring series",
      });
    }

    db.prepare(`
      INSERT INTO task_occurrences (
        task_id,
        occurrence_date,
        is_deleted,
        updated_at
      )
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)

      ON CONFLICT (
        task_id,
        occurrence_date
      )
      DO UPDATE SET
        is_deleted = 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      taskId,
      occurrenceDate
    );

    res.json({
      success: true,
      task_id: taskId,
      occurrence_date:
        occurrenceDate,
    });
  }
);

router.delete(
  "/:id/future/:occurrenceDate",
  (req, res) => {
    const taskId =
      Number(req.params.id);

    const occurrenceDate =
      req.params.occurrenceDate;

    const existingTask =
      getTaskById(taskId);

    if (!existingTask) {
      return res.status(404).json({
        success: false,
        error: "Task not found",
      });
    }

    if (!existingTask.is_recurring) {
      return res.status(400).json({
        success: false,
        error:
          "Task is not part of a recurring series",
      });
    }

    /*
     * If deleting from the first occurrence,
     * there is no earlier part of the series
     * to preserve.
     */
    if (
      occurrenceDate ===
      existingTask.due_date
    ) {
      db.prepare(`
        DELETE FROM tasks
        WHERE id = ?
      `).run(taskId);

      return res.json({
        success: true,
        deleted_series: true,
      });
    }

    const previousDate =
      parseDateKey(occurrenceDate);

    previousDate.setDate(
      previousDate.getDate() - 1
    );

    const previousDateKey =
      formatDateKey(previousDate);

    const transaction =
      db.transaction(() => {
        /*
         * End the recurring series before
         * the selected occurrence.
         */
        db.prepare(`
          UPDATE tasks
          SET
            recurrence_end_date = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          previousDateKey,
          taskId
        );

        /*
         * Remove stored occurrence state
         * that can no longer be reached.
         */
        db.prepare(`
          DELETE FROM task_occurrences
          WHERE task_id = ?
            AND occurrence_date >= ?
        `).run(
          taskId,
          occurrenceDate
        );
      });

    transaction();

    res.json({
      success: true,
      task_id: taskId,
      recurrence_end_date:
        previousDateKey,
    });
  }
);

router.patch("/:id/completion", (req, res) => {
  const taskId = Number(req.params.id);

  const completed =
    Boolean(req.body.completed);

  const occurrenceDate =
    req.body.occurrenceDate || null;

  const existingTask =
    getTaskById(taskId);

    if (
  existingTask.is_recurring &&
  !occurrenceDate
) {
  return res.status(400).json({
    success: false,
    error:
      "Occurrence date is required for recurring tasks",
  });
}

  if (!existingTask) {
    return res.status(404).json({
      success: false,
      error: "Task not found",
    });
  }

  /*
   * Recurring task occurrence
   */
  if (
    existingTask.is_recurring &&
    occurrenceDate
  ) {
    const completedAt =
      completed
        ? new Date().toISOString()
        : null;

    db.prepare(`
      INSERT INTO task_occurrences (
        task_id,
        occurrence_date,
        is_completed,
        completed_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)

      ON CONFLICT (
        task_id,
        occurrence_date
      )
      DO UPDATE SET
        is_completed = excluded.is_completed,
        completed_at = excluded.completed_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      taskId,
      occurrenceDate,
      completed ? 1 : 0,
      completedAt
    );

    const occurrenceState =
      getOccurrenceState(
        taskId,
        occurrenceDate
      );

    return res.json({
      success: true,
      task: {
        ...existingTask,
        due_date: occurrenceDate,
        is_completed:
          occurrenceState.is_completed,
        completed_at:
          occurrenceState.completed_at,
        is_occurrence: true,
        occurrence_date:
          occurrenceDate,
        occurrence_key:
          `${taskId}:${occurrenceDate}`,
      },
    });
  }

  /*
   * Normal non-recurring task
   */
  db.prepare(`
    UPDATE tasks
    SET
      is_completed = ?,
      completed_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    completed ? 1 : 0,
    completed
      ? new Date().toISOString()
      : null,
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