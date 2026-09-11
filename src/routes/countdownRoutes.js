const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const router = express.Router();

const dbPath = path.join(
  __dirname,
  "../../data/familyhub.db"
);

const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

function getNextBirthdayDate(birthday) {
  if (!birthday) {
    return null;
  }

  const parts = String(birthday).split("-");

  if (parts.length !== 3) {
    return null;
  }

  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (!month || !day) {
    return null;
  }

  const now = new Date();

  let year = now.getFullYear();

  function buildDate(targetYear) {
    const date = new Date(
      targetYear,
      month - 1,
      day,
      12,
      0,
      0
    );

    if (
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return new Date(
        targetYear,
        1,
        28,
        12,
        0,
        0
      );
    }

    return date;
  }

  let targetDate = buildDate(year);

  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const birthdayThisYear = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate()
  );

  if (birthdayThisYear < today) {
    year += 1;
    targetDate = buildDate(year);
  }

  const yyyy = targetDate.getFullYear();
  const mm = String(
    targetDate.getMonth() + 1
  ).padStart(2, "0");
  const dd = String(
    targetDate.getDate()
  ).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function syncBirthdayCountdowns() {
  const members = db
    .prepare(`
      SELECT
        id,
        name,
        colour,
        birthday
      FROM family_members
      WHERE
        is_active = 1
        AND birthday IS NOT NULL
        AND birthday != ''
    `)
    .all();

  const memberIdsWithBirthdays =
    new Set(members.map((member) => member.id));

  const automaticBirthdays = db
    .prepare(`
      SELECT
        id,
        family_member_id
      FROM countdowns
      WHERE
        is_automatic = 1
        AND category = 'birthday'
    `)
    .all();

  for (const countdown of automaticBirthdays) {
    if (
      !memberIdsWithBirthdays.has(
        countdown.family_member_id
      )
    ) {
      db.prepare(`
        DELETE FROM countdowns
        WHERE id = ?
      `).run(countdown.id);
    }
  }

  for (const member of members) {
    const targetDate =
      getNextBirthdayDate(member.birthday);

    if (!targetDate) {
      continue;
    }

    const existingCountdown = db
      .prepare(`
        SELECT *
        FROM countdowns
        WHERE
          family_member_id = ?
          AND is_automatic = 1
          AND category = 'birthday'
        LIMIT 1
      `)
      .get(member.id);

    const title = `${member.name}'s Birthday`;

    if (existingCountdown) {
      db.prepare(`
        UPDATE countdowns
        SET
          title = ?,
          target_date = ?,
          target_time = NULL,
          description = NULL,
          colour = ?,
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        title,
        targetDate,
        member.colour || null,
        existingCountdown.id
      );
    } else {
      db.prepare(`
        INSERT INTO countdowns (
          title,
          target_date,
          target_time,
          description,
          category,
          colour,
          event_id,
          family_member_id,
          is_automatic,
          is_active
        )
        VALUES (?, ?, NULL, NULL, 'birthday', ?, NULL, ?, 1, 1)
      `).run(
        title,
        targetDate,
        member.colour || null,
        member.id
      );
    }
  }
}


// =========================================================
// GET ALL COUNTDOWNS
// =========================================================

router.get("/", (req, res) => {
  try {
    syncBirthdayCountdowns();

    const countdowns = db
      .prepare(`
SELECT
  countdowns.*,
  family_members.name AS family_member_name,
  family_members.colour AS family_member_colour,
  family_members.initials AS family_member_initials,
  family_members.birthday AS family_member_birthday
FROM countdowns
        LEFT JOIN family_members
          ON family_members.id = countdowns.family_member_id
        WHERE countdowns.is_active = 1
        ORDER BY
          countdowns.target_date ASC,
          countdowns.target_time ASC
      `)
      .all();

    res.json({
      success: true,
      countdowns,
    });
  } catch (error) {
    console.error(
      "Failed to load countdowns:",
      error
    );

    res.status(500).json({
      success: false,
      error: "Failed to load countdowns",
    });
  }
});


// =========================================================
// GET ONE COUNTDOWN
// =========================================================

router.get("/:id", (req, res) => {
  try {
    const countdown = db
      .prepare(`
SELECT
  countdowns.*,
  family_members.name AS family_member_name,
  family_members.colour AS family_member_colour,
  family_members.initials AS family_member_initials,
  family_members.birthday AS family_member_birthday
FROM countdowns
        LEFT JOIN family_members
          ON family_members.id = countdowns.family_member_id
        WHERE countdowns.id = ?
      `)
      .get(req.params.id);

    if (!countdown) {
      return res.status(404).json({
        success: false,
        error: "Countdown not found",
      });
    }

    res.json({
      success: true,
      countdown,
    });
  } catch (error) {
    console.error(
      "Failed to load countdown:",
      error
    );

    res.status(500).json({
      success: false,
      error: "Failed to load countdown",
    });
  }
});


// =========================================================
// CREATE COUNTDOWN
// =========================================================

router.post("/", (req, res) => {
  try {
    const {
      title,
      targetDate,
      targetTime = null,
      description = null,
      category = "other",
      colour = null,
      eventId = null,
      familyMemberId = null,
      isAutomatic = false,
      isActive = true,
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({
        success: false,
        error: "Title is required",
      });
    }

    if (!targetDate) {
      return res.status(400).json({
        success: false,
        error: "Target date is required",
      });
    }

    const result = db
      .prepare(`
        INSERT INTO countdowns (
          title,
          target_date,
          target_time,
          description,
          category,
          colour,
          event_id,
          family_member_id,
          is_automatic,
          is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        title.trim(),
        targetDate,
        targetTime || null,
        description?.trim() || null,
        category || "other",
        colour || null,
        eventId || null,
        familyMemberId || null,
        isAutomatic ? 1 : 0,
        isActive ? 1 : 0
      );

    const countdown = db
      .prepare(`
        SELECT *
        FROM countdowns
        WHERE id = ?
      `)
      .get(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      countdown,
    });
  } catch (error) {
    console.error(
      "Failed to create countdown:",
      error
    );

    res.status(500).json({
      success: false,
      error: "Failed to create countdown",
    });
  }
});


// =========================================================
// UPDATE COUNTDOWN
// =========================================================

router.put("/:id", (req, res) => {
  try {
    const existing = db
      .prepare(`
        SELECT *
        FROM countdowns
        WHERE id = ?
      `)
      .get(req.params.id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Countdown not found",
      });
    }

    const {
      title = existing.title,
      targetDate = existing.target_date,
      targetTime = existing.target_time,
      description = existing.description,
      category = existing.category,
      colour = existing.colour,
      eventId = existing.event_id,
      familyMemberId = existing.family_member_id,
      isAutomatic = Boolean(
        existing.is_automatic
      ),
      isActive = Boolean(existing.is_active),
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({
        success: false,
        error: "Title is required",
      });
    }

    if (!targetDate) {
      return res.status(400).json({
        success: false,
        error: "Target date is required",
      });
    }

    db.prepare(`
      UPDATE countdowns
      SET
        title = ?,
        target_date = ?,
        target_time = ?,
        description = ?,
        category = ?,
        colour = ?,
        event_id = ?,
        family_member_id = ?,
        is_automatic = ?,
        is_active = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title.trim(),
      targetDate,
      targetTime || null,
      description?.trim() || null,
      category || "other",
      colour || null,
      eventId || null,
      familyMemberId || null,
      isAutomatic ? 1 : 0,
      isActive ? 1 : 0,
      req.params.id
    );

    const countdown = db
      .prepare(`
        SELECT *
        FROM countdowns
        WHERE id = ?
      `)
      .get(req.params.id);

    res.json({
      success: true,
      countdown,
    });
  } catch (error) {
    console.error(
      "Failed to update countdown:",
      error
    );

    res.status(500).json({
      success: false,
      error: "Failed to update countdown",
    });
  }
});


// =========================================================
// DELETE COUNTDOWN
// =========================================================

router.delete("/:id", (req, res) => {
  try {
    const result = db
      .prepare(`
        DELETE FROM countdowns
        WHERE id = ?
      `)
      .run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: "Countdown not found",
      });
    }

    res.json({
      success: true,
    });
  } catch (error) {
    console.error(
      "Failed to delete countdown:",
      error
    );

    res.status(500).json({
      success: false,
      error: "Failed to delete countdown",
    });
  }
});


module.exports = router;