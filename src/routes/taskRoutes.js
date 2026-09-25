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
        reminder_enabled,
        reminder_minutes,
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
      reminder_enabled: null,
      reminder_minutes: null,
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

    reminder_enabled:
      row.reminder_enabled !== null
        ? Boolean(row.reminder_enabled)
        : null,

    reminder_minutes:
      row.reminder_minutes !== null
        ? Number(row.reminder_minutes)
        : null,

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

const today = new Date();

today.setHours(
  12,
  0,
  0,
  0
);

const rangeStart =
  startDate
    ? parseDateKey(startDate)
    : today;

const rangeEnd =
  endDate
    ? parseDateKey(endDate)
    : today;

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

      reminder_enabled:
        occurrenceState.reminder_enabled === null
          ? task.reminder_enabled
          : occurrenceState.reminder_enabled,

      reminder_minutes:
        occurrenceState.reminder_enabled === null
          ? task.reminder_minutes
          : occurrenceState.reminder_enabled
            ? occurrenceState.reminder_minutes
            : null,

      is_completed:
        occurrenceState.is_completed,

completed_at:
  occurrenceState.completed_at,

members:
  getMemberCompletionStates(
    task.id,
    occurrenceKey
  ),

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

function getMemberCompletionStates(
  taskId,
  occurrenceDate = ""
) {
  const members = db
    .prepare(`
      SELECT
        fm.id,
        fm.name,
        fm.colour,
        fm.initials,
        fm.photo_url,
        COALESCE(
          tmc.is_completed,
          0
        ) AS is_completed,
        tmc.completed_at
      FROM task_members tm

      JOIN family_members fm
        ON fm.id = tm.family_member_id

      LEFT JOIN task_member_completions tmc
        ON tmc.task_id = tm.task_id
        AND tmc.family_member_id =
          tm.family_member_id
        AND tmc.occurrence_date = ?

      WHERE tm.task_id = ?

      ORDER BY
        fm.display_order ASC,
        fm.name ASC
    `)
    .all(
      occurrenceDate || "",
      taskId
    );

  return members.map((member) => ({
    ...member,
    is_completed:
      Boolean(member.is_completed),
    completed_at:
      member.completed_at || null,
  }));
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
  reminder_enabled,
  reminder_minutes,
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

  const reward = db
    .prepare(`
      SELECT star_value
      FROM task_rewards
      WHERE task_id = ?
    `)
    .get(id);

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
  reminder_enabled: Boolean(task.reminder_enabled),
  reminder_minutes:
    task.reminder_minutes !== null
      ? Number(task.reminder_minutes)
      : null,
  is_recurring: Boolean(task.is_recurring),
  star_value:
    Number(reward?.star_value) || 1,
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

router.get("/rewards", (req, res) => {
  const rewards = db
    .prepare(`
      SELECT
        id,
        title,
        description,
        star_cost,
        is_active,
        created_at,
        updated_at
      FROM rewards
      WHERE is_active = 1
      ORDER BY
        star_cost ASC,
        title ASC
    `)
    .all();

  res.json({
    success: true,
    rewards: rewards.map((reward) => ({
      ...reward,
      star_cost:
        Number(reward.star_cost) || 0,
      is_active:
        Boolean(reward.is_active),
    })),
  });
});

router.post("/rewards", (req, res) => {
  const {
    title,
    description = null,
    starCost = 10,
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Reward title is required",
    });
  }

  const result = db
    .prepare(`
      INSERT INTO rewards (
        title,
        description,
        star_cost
      )
      VALUES (?, ?, ?)
    `)
    .run(
      title.trim(),
      description?.trim() || null,
      Math.max(
        0,
        Number(starCost) || 0
      )
    );

  const reward = db
    .prepare(`
      SELECT
        id,
        title,
        description,
        star_cost,
        is_active,
        created_at,
        updated_at
      FROM rewards
      WHERE id = ?
    `)
    .get(
      Number(result.lastInsertRowid)
    );

  res.status(201).json({
    success: true,
    reward: {
      ...reward,
      star_cost:
        Number(reward.star_cost) || 0,
      is_active:
        Boolean(reward.is_active),
    },
  });
});

router.put("/rewards/:id", (req, res) => {
  const rewardId =
    Number(req.params.id);

  const existingReward = db
    .prepare(`
      SELECT id
      FROM rewards
      WHERE id = ?
    `)
    .get(rewardId);

  if (!existingReward) {
    return res.status(404).json({
      success: false,
      error: "Reward not found",
    });
  }

  const {
    title,
    description = null,
    starCost = 10,
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Reward title is required",
    });
  }

  db.prepare(`
    UPDATE rewards
    SET
      title = ?,
      description = ?,
      star_cost = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title.trim(),
    description?.trim() || null,
    Math.max(
      0,
      Number(starCost) || 0
    ),
    rewardId
  );

  const reward = db
    .prepare(`
      SELECT
        id,
        title,
        description,
        star_cost,
        is_active,
        created_at,
        updated_at
      FROM rewards
      WHERE id = ?
    `)
    .get(rewardId);

  res.json({
    success: true,
    reward: {
      ...reward,
      star_cost:
        Number(reward.star_cost) || 0,
      is_active:
        Boolean(reward.is_active),
    },
  });
});

router.delete(
  "/rewards/:id",
  (req, res) => {
    const rewardId =
      Number(req.params.id);

    const existingReward = db
      .prepare(`
        SELECT id
        FROM rewards
        WHERE id = ?
      `)
      .get(rewardId);

    if (!existingReward) {
      return res.status(404).json({
        success: false,
        error: "Reward not found",
      });
    }

    db.prepare(`
      UPDATE rewards
      SET
        is_active = 0,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(rewardId);

    res.json({
      success: true,
    });
  }
);

router.post(
  "/rewards/:id/redeem",
  (req, res) => {
    const rewardId =
      Number(req.params.id);

    const {
      familyMemberId,
    } = req.body;

    if (!familyMemberId) {
      return res.status(400).json({
        success: false,
        error:
          "Family member is required",
      });
    }

    const reward = db
      .prepare(`
        SELECT
          id,
          title,
          description,
          star_cost,
          is_active
        FROM rewards
        WHERE id = ?
          AND is_active = 1
      `)
      .get(rewardId);

    if (!reward) {
      return res.status(404).json({
        success: false,
        error: "Reward not found",
      });
    }

    const member = db
      .prepare(`
        SELECT
          id,
          name
        FROM family_members
        WHERE id = ?
          AND is_active = 1
      `)
      .get(
        Number(familyMemberId)
      );

    if (!member) {
      return res.status(404).json({
        success: false,
        error:
          "Family member not found",
      });
    }

const starCost =
  Math.max(
    0,
    Number(reward.star_cost) || 0
  );

const redeemReward =
  db.transaction(() => {
    const balanceRow = db
      .prepare(`
        SELECT
          COALESCE(
            SUM(stars),
            0
          ) AS stars
        FROM family_star_transactions
        WHERE family_member_id = ?
      `)
      .get(member.id);

    const currentBalance =
      Number(balanceRow?.stars) || 0;

    if (currentBalance < starCost) {
      return {
        success: false,
        balance: currentBalance,
      };
    }

    db.prepare(`
      INSERT INTO
        family_star_transactions (
          family_member_id,
          task_id,
          occurrence_date,
          stars,
          transaction_type,
          description
        )
      VALUES (
        ?, NULL, '', ?,
        'redemption', ?
      )
    `).run(
      member.id,
      -starCost,
      `Redeemed: ${reward.title}`
    );

    return {
      success: true,
      balance:
        currentBalance - starCost,
    };
  });

const redemptionResult =
  redeemReward();

if (!redemptionResult.success) {
  return res.status(400).json({
    success: false,
    error:
      `${member.name} needs ${
        starCost - redemptionResult.balance
      } more stars`,
    balance: redemptionResult.balance,
    required: starCost,
  });
}

const newBalance =
  redemptionResult.balance;

    res.json({
      success: true,

      redemption: {
        rewardId: reward.id,
        rewardTitle: reward.title,
        familyMemberId: member.id,
        familyMemberName:
          member.name,
        starsSpent: starCost,
        remainingStars:
          newBalance,
      },
    });
  }
);

router.get(
  "/rewards/history",
  (req, res) => {
    try {
      const history = db
        .prepare(`
          SELECT
            fst.id,
            fst.family_member_id,
            fst.stars,
            fst.description,
            fst.created_at,

            fm.name AS member_name,
            fm.colour AS member_colour,
            fm.initials AS member_initials,
            fm.photo_url AS member_photo_url

          FROM family_star_transactions fst

          JOIN family_members fm
            ON fm.id =
              fst.family_member_id

          WHERE
            fst.transaction_type =
              'redemption'

          ORDER BY
            fst.created_at DESC,
            fst.id DESC

          LIMIT 50
        `)
        .all();

      res.json({
        success: true,

        history:
          history.map((item) => ({
            id: item.id,

            familyMemberId:
              item.family_member_id,

            memberName:
              item.member_name,

            memberColour:
              item.member_colour,

            memberInitials:
              item.member_initials,

            memberPhotoUrl:
              item.member_photo_url,

            starsSpent:
              Math.abs(
                Number(item.stars) || 0
              ),

            description:
              item.description,

            createdAt:
              item.created_at,
          })),
      });
    } catch (error) {
      console.error(
        "Reward history error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to load reward history",
      });
    }
  }
);

router.get(
  "/rewards/goals",
  (req, res) => {
    try {
      const members = db
        .prepare(`
          SELECT
            fm.id,
            fm.name,
            fm.colour,
            fm.initials,
            fm.photo_url,

            COALESCE(
              SUM(fst.stars),
              0
            ) AS stars,

            frg.reward_id,

            r.title AS reward_title,
            r.description AS reward_description,
            r.star_cost AS reward_star_cost

          FROM family_members fm

          LEFT JOIN family_star_transactions fst
            ON fst.family_member_id = fm.id

          LEFT JOIN family_reward_goals frg
            ON frg.family_member_id = fm.id

          LEFT JOIN rewards r
            ON r.id = frg.reward_id
            AND r.is_active = 1

          WHERE fm.is_active = 1

          GROUP BY
            fm.id,
            fm.name,
            fm.colour,
            fm.initials,
            fm.photo_url,
            frg.reward_id,
            r.title,
            r.description,
            r.star_cost

          ORDER BY
            fm.display_order ASC,
            fm.name ASC
        `)
        .all();

      res.json({
        success: true,

        goals: members.map((member) => {
          const stars =
            Number(member.stars) || 0;

          const starCost =
            member.reward_star_cost !== null
              ? Number(
                  member.reward_star_cost
                )
              : null;

          const progress =
            starCost &&
            starCost > 0
              ? Math.min(
                  100,
                  Math.round(
                    (stars /
                      starCost) *
                      100
                  )
                )
              : 0;

          return {
            familyMemberId:
              member.id,

            memberName:
              member.name,

            memberColour:
              member.colour,

            memberInitials:
              member.initials,

            memberPhotoUrl:
              member.photo_url,

            stars,

            rewardId:
              member.reward_id,

            rewardTitle:
              member.reward_title,

            rewardDescription:
              member.reward_description,

            rewardStarCost:
              starCost,

            progress,

            starsRemaining:
              starCost !== null
                ? Math.max(
                    0,
                    starCost - stars
                  )
                : null,
          };
        }),
      });
    } catch (error) {
      console.error(
        "Reward goals error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to load reward goals",
      });
    }
  }
);

router.put(
  "/rewards/goals/:memberId",
  (req, res) => {
    const memberId =
      Number(req.params.memberId);

    const {
      rewardId,
    } = req.body;

    const member = db
      .prepare(`
        SELECT id
        FROM family_members
        WHERE id = ?
          AND is_active = 1
      `)
      .get(memberId);

    if (!member) {
      return res.status(404).json({
        success: false,
        error:
          "Family member not found",
      });
    }

    if (
      rewardId === null ||
      rewardId === undefined ||
      rewardId === ""
    ) {
      db.prepare(`
        DELETE FROM family_reward_goals
        WHERE family_member_id = ?
      `).run(memberId);

      return res.json({
        success: true,
        rewardId: null,
      });
    }

    const reward = db
      .prepare(`
        SELECT id
        FROM rewards
        WHERE id = ?
          AND is_active = 1
      `)
      .get(
        Number(rewardId)
      );

    if (!reward) {
      return res.status(404).json({
        success: false,
        error:
          "Reward not found",
      });
    }

    db.prepare(`
      INSERT INTO family_reward_goals (
        family_member_id,
        reward_id
      )
      VALUES (?, ?)

      ON CONFLICT(family_member_id)
      DO UPDATE SET
        reward_id =
          excluded.reward_id,
        updated_at =
          CURRENT_TIMESTAMP
    `).run(
      memberId,
      reward.id
    );

    res.json({
      success: true,
      familyMemberId:
        memberId,
      rewardId:
        reward.id,
    });
  }
);

router.get(
  "/rewards/summary",
  (req, res) => {
    const members = db
      .prepare(`
        SELECT
          fm.id,
          fm.name,
          fm.colour,
          fm.initials,
          fm.photo_url,

          COALESCE(
            SUM(fst.stars),
            0
          ) AS stars

        FROM family_members fm

        LEFT JOIN family_star_transactions fst
          ON fst.family_member_id = fm.id

        WHERE fm.is_active = 1

        GROUP BY
          fm.id,
          fm.name,
          fm.colour,
          fm.initials,
          fm.photo_url,
          fm.display_order

        ORDER BY
          fm.display_order ASC,
          fm.name ASC
      `)
      .all();

    res.json({
      success: true,

      members: members.map(
        (member) => ({
          ...member,

          stars:
            Number(member.stars) || 0,
        })
      ),
    });
  }
);

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
  reminderEnabled = false,
  reminderMinutes = null,
  memberIds = [],
  isRecurring = false,
  recurrenceRule = null,
  recurrenceEndDate = null,
  recurrenceCount = null,
  starValue = 1,
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

  if (
    reminderEnabled &&
    (
      !dueTime ||
      reminderMinutes === null ||
      !Number.isFinite(Number(reminderMinutes)) ||
      Number(reminderMinutes) < 0
    )
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Task reminders require a due time and valid non-negative reminder minutes.",
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
          reminder_enabled,
          reminder_minutes,
          is_recurring,
          recurrence_rule,
          recurrence_end_date,
          recurrence_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        title.trim(),
        description,
        dueDate,
        dueTime,
        priority,
        category,
        reminderEnabled ? 1 : 0,
        reminderEnabled && reminderMinutes !== null
          ? Number(reminderMinutes)
          : null,
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

db.prepare(`
  INSERT INTO task_rewards (
    task_id,
    star_value
  )
  VALUES (?, ?)
`).run(
  taskId,
  Math.max(
    0,
    Number(starValue) || 0
  )
);

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
  reminderEnabled = false,
  reminderMinutes = null,
  memberIds = [],
  isRecurring = false,
  recurrenceRule = null,
  recurrenceEndDate = null,
  recurrenceCount = null,
  starValue = 1,
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

  if (
    reminderEnabled &&
    (
      !dueTime ||
      reminderMinutes === null ||
      !Number.isFinite(Number(reminderMinutes)) ||
      Number(reminderMinutes) < 0
    )
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Task reminders require a due time and valid non-negative reminder minutes.",
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
        reminder_enabled = ?,
        reminder_minutes = ?,
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
  reminderEnabled ? 1 : 0,
  reminderEnabled && reminderMinutes !== null
    ? Number(reminderMinutes)
    : null,
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

db.prepare(`
  INSERT INTO task_rewards (
    task_id,
    star_value
  )
  VALUES (?, ?)

  ON CONFLICT(task_id)
  DO UPDATE SET
    star_value =
      excluded.star_value,
    updated_at =
      CURRENT_TIMESTAMP
`).run(
  taskId,
  Math.max(
    0,
    Number(starValue) || 0
  )
);
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
    reminderEnabled = null,
    reminderMinutes = null,
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  if (
    reminderEnabled === true &&
    (
      !dueTime ||
      reminderMinutes === null ||
      !Number.isFinite(Number(reminderMinutes)) ||
      Number(reminderMinutes) < 0
    )
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Task reminders require a due time and valid non-negative reminder minutes.",
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
      reminder_enabled,
      reminder_minutes,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

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
      reminder_enabled = excluded.reminder_enabled,
      reminder_minutes = excluded.reminder_minutes,
      is_deleted = 0,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    taskId,
    occurrenceDate,
    title.trim(),
    description,
    dueTime,
    priority,
    category,
    reminderEnabled === null
      ? null
      : reminderEnabled
        ? 1
        : 0,
    reminderEnabled === true &&
    reminderMinutes !== null
      ? Number(reminderMinutes)
      : null
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

      reminder_enabled:
        occurrenceState.reminder_enabled === null
          ? existingTask.reminder_enabled
          : occurrenceState.reminder_enabled,

      reminder_minutes:
        occurrenceState.reminder_enabled === null
          ? existingTask.reminder_minutes
          : occurrenceState.reminder_enabled
            ? occurrenceState.reminder_minutes
            : null,

is_completed:
  occurrenceState.is_completed,

completed_at:
  occurrenceState.completed_at,

members:
  getMemberCompletionStates(
    taskId,
    occurrenceDate
  ),

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
  reminderEnabled = false,
  reminderMinutes = null,
  memberIds = [],
  recurrenceRule = null,
  recurrenceEndDate = null,
  starValue = 1,
} = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  if (
    reminderEnabled &&
    (
      !dueTime ||
      reminderMinutes === null ||
      !Number.isFinite(Number(reminderMinutes)) ||
      Number(reminderMinutes) < 0
    )
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Task reminders require a due time and valid non-negative reminder minutes.",
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
            reminder_enabled,
            reminder_minutes,
            is_completed,
            is_recurring,
            recurrence_rule,
            recurrence_end_date,
            recurrence_count
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?,
            0, 1, ?, ?, NULL
          )
        `).run(
          title.trim(),
          description,
          occurrenceDate,
          dueTime,
          priority,
          category,
          reminderEnabled ? 1 : 0,
          reminderEnabled && reminderMinutes !== null
            ? Number(reminderMinutes)
            : null,
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

db.prepare(`
  INSERT INTO task_rewards (
    task_id,
    star_value
  )
  VALUES (?, ?)
`).run(
  newTaskId,
  Math.max(
    0,
    Number(starValue) || 0
  )
);

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

const deleteOccurrence =
  db.transaction(() => {
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
        is_completed = 0,
        completed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      taskId,
      occurrenceDate
    );

    db.prepare(`
      DELETE FROM task_member_completions
      WHERE task_id = ?
        AND occurrence_date = ?
    `).run(
      taskId,
      occurrenceDate
    );

    db.prepare(`
      DELETE FROM family_star_transactions
      WHERE task_id = ?
        AND occurrence_date = ?
        AND transaction_type = 'task'
    `).run(
      taskId,
      occurrenceDate
    );
  });

deleteOccurrence();

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

db.prepare(`
  DELETE FROM task_member_completions
  WHERE task_id = ?
    AND occurrence_date >= ?
`).run(
  taskId,
  occurrenceDate
);

db.prepare(`
  DELETE FROM family_star_transactions
  WHERE task_id = ?
    AND occurrence_date >= ?
    AND transaction_type = 'task'
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

router.patch(
  "/:id/members/:memberId/completion",
  (req, res) => {
    const taskId =
      Number(req.params.id);

    const memberId =
      Number(req.params.memberId);

    const completed =
      Boolean(req.body.completed);

    const occurrenceDate =
      req.body.occurrenceDate || "";

    const existingTask =
      getTaskById(taskId);

    if (!existingTask) {
      return res.status(404).json({
        success: false,
        error: "Task not found",
      });
    }

    const assignedMember =
      existingTask.members.find(
        (member) =>
          Number(member.id) === memberId
      );

    if (!assignedMember) {
      return res.status(400).json({
        success: false,
        error:
          "Family member is not assigned to this task",
      });
    }

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

    const completionDate =
      existingTask.is_recurring
        ? occurrenceDate
        : "";

    const completedAt =
      completed
        ? new Date().toISOString()
        : null;

    db.prepare(`
      INSERT INTO task_member_completions (
        task_id,
        family_member_id,
        occurrence_date,
        is_completed,
        completed_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?,
        CURRENT_TIMESTAMP
      )

      ON CONFLICT (
        task_id,
        family_member_id,
        occurrence_date
      )
      DO UPDATE SET
        is_completed =
          excluded.is_completed,
        completed_at =
          excluded.completed_at,
        updated_at =
          CURRENT_TIMESTAMP
    `).run(
      taskId,
      memberId,
      completionDate,
      completed ? 1 : 0,
      completedAt
    );

    const reward =
  db.prepare(`
    SELECT star_value
    FROM task_rewards
    WHERE task_id = ?
  `).get(taskId);

const starValue =
  reward?.star_value ?? 1;

if (completed) {
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
      ?, ?, ?, ?, 'task', ?
    )

    ON CONFLICT (
      family_member_id,
      task_id,
      occurrence_date,
      transaction_type
    )
    DO UPDATE SET
      stars = excluded.stars,
      description = excluded.description
  `).run(
    memberId,
    taskId,
    completionDate,
    starValue,
    existingTask.title
  );
} else {
  db.prepare(`
    DELETE FROM family_star_transactions
    WHERE family_member_id = ?
      AND task_id = ?
      AND occurrence_date = ?
      AND transaction_type = 'task'
  `).run(
    memberId,
    taskId,
    completionDate
  );
}

    const memberStates =
      getMemberCompletionStates(
        taskId,
        completionDate
      );

const completionSummary =
  db.prepare(`
    SELECT
      (
        SELECT COUNT(*)
        FROM task_members
        WHERE task_id = ?
      ) AS assigned_count,

      (
        SELECT COUNT(*)
        FROM task_member_completions tmc

        INNER JOIN task_members tm
          ON tm.task_id =
            tmc.task_id
          AND tm.family_member_id =
            tmc.family_member_id

        WHERE tmc.task_id = ?
          AND tmc.occurrence_date = ?
          AND tmc.is_completed = 1
      ) AS completed_count
  `).get(
    taskId,
    taskId,
    completionDate
  );

const allCompleted =
  completionSummary.assigned_count > 0 &&
  completionSummary.completed_count ===
    completionSummary.assigned_count;

    const taskCompletedAt =
      allCompleted
        ? new Date().toISOString()
        : null;

    if (existingTask.is_recurring) {
      db.prepare(`
        INSERT INTO task_occurrences (
          task_id,
          occurrence_date,
          is_completed,
          completed_at,
          updated_at
        )
        VALUES (
          ?, ?, ?, ?,
          CURRENT_TIMESTAMP
        )

        ON CONFLICT (
          task_id,
          occurrence_date
        )
        DO UPDATE SET
          is_completed =
            excluded.is_completed,
          completed_at =
            excluded.completed_at,
          updated_at =
            CURRENT_TIMESTAMP
      `).run(
        taskId,
        occurrenceDate,
        allCompleted ? 1 : 0,
        taskCompletedAt
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

          reminder_enabled:
            occurrenceState.reminder_enabled === null
              ? existingTask.reminder_enabled
              : occurrenceState.reminder_enabled,

          reminder_minutes:
            occurrenceState.reminder_enabled === null
              ? existingTask.reminder_minutes
              : occurrenceState.reminder_enabled
                ? occurrenceState.reminder_minutes
                : null,

          is_completed:
            allCompleted,

          completed_at:
            taskCompletedAt,

          members:
            memberStates,

          is_occurrence: true,

          occurrence_date:
            occurrenceDate,

          occurrence_key:
            `${taskId}:${occurrenceDate}`,
        },
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
      allCompleted ? 1 : 0,
      taskCompletedAt,
      taskId
    );

    return res.json({
      success: true,
      task: {
        ...getTaskById(taskId),
        members: memberStates,
        is_completed:
          allCompleted,
        completed_at:
          taskCompletedAt,
      },
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

if (!existingTask) {
  return res.status(404).json({
    success: false,
    error: "Task not found",
  });
}

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

        reminder_enabled:
          occurrenceState.reminder_enabled === null
            ? existingTask.reminder_enabled
            : occurrenceState.reminder_enabled,

        reminder_minutes:
          occurrenceState.reminder_enabled === null
            ? existingTask.reminder_minutes
            : occurrenceState.reminder_enabled
              ? occurrenceState.reminder_minutes
              : null,

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
const completedAt =
  completed
    ? new Date().toISOString()
    : null;

const updateNormalTask =
  db.transaction(() => {
    db.prepare(`
      UPDATE tasks
      SET
        is_completed = ?,
        completed_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      completed ? 1 : 0,
      completedAt,
      taskId
    );

    const reward =
      db.prepare(`
        SELECT star_value
        FROM task_rewards
        WHERE task_id = ?
      `).get(taskId);

    const starValue =
      Number(reward?.star_value) || 0;

    for (const member of existingTask.members) {
      if (completed) {
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
            ?, ?, '', ?, 'task', ?
          )

          ON CONFLICT (
            family_member_id,
            task_id,
            occurrence_date,
            transaction_type
          )
          DO UPDATE SET
            stars = excluded.stars,
            description = excluded.description
        `).run(
          member.id,
          taskId,
          starValue,
          existingTask.title
        );
      } else {
        db.prepare(`
          DELETE FROM family_star_transactions
          WHERE family_member_id = ?
            AND task_id = ?
            AND occurrence_date = ''
            AND transaction_type = 'task'
        `).run(
          member.id,
          taskId
        );
      }
    }
  });

updateNormalTask();

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