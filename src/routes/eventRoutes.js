const express = require("express");
const db = require("../database/db");

const router = express.Router();

function getEventById(id) {
  const event = db
    .prepare(`
      SELECT
        id,
        title,
        description,
        start_date,
        start_time,
        end_date,
        end_time,
        all_day,
        location,
        category,
        created_at,
        updated_at
      FROM events
      WHERE id = ?
    `)
    .get(id);

  if (!event) {
    return null;
  }

  const members = db
    .prepare(`
      SELECT
        fm.id,
        fm.name,
        fm.colour,
        fm.initials
      FROM event_members em
      JOIN family_members fm
        ON fm.id = em.family_member_id
      WHERE em.event_id = ?
      ORDER BY fm.display_order ASC, fm.name ASC
    `)
    .all(id);

  return {
    ...event,
    all_day: Boolean(event.all_day),
    members,
  };
}

router.get("/", (req, res) => {
  const {
    start,
    end,
    memberId,
  } = req.query;

  let sql = `
    SELECT DISTINCT
      e.id
    FROM events e
    LEFT JOIN event_members em
      ON em.event_id = e.id
    WHERE 1 = 1
  `;

  const params = [];

  if (start) {
    sql += ` AND e.start_date >= ?`;
    params.push(start);
  }

  if (end) {
    sql += ` AND e.start_date <= ?`;
    params.push(end);
  }

  if (memberId) {
    sql += ` AND em.family_member_id = ?`;
    params.push(Number(memberId));
  }

  sql += `
    ORDER BY
      e.start_date ASC,
      CASE
        WHEN e.all_day = 1 THEN '00:00'
        ELSE COALESCE(e.start_time, '23:59')
      END ASC,
      e.title ASC
  `;

  const rows = db.prepare(sql).all(...params);

  const events = rows
    .map((row) => getEventById(row.id))
    .filter(Boolean);

  res.json({
    success: true,
    events,
  });
});

router.get("/:id", (req, res) => {
  const event = getEventById(Number(req.params.id));

  if (!event) {
    return res.status(404).json({
      success: false,
      error: "Event not found",
    });
  }

  res.json({
    success: true,
    event,
  });
});

router.post("/", (req, res) => {
  const {
    title,
    description = null,
    startDate,
    startTime = null,
    endDate = null,
    endTime = null,
    allDay = false,
    location = null,
    category = "other",
    memberIds = [],
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  if (!startDate) {
    return res.status(400).json({
      success: false,
      error: "Start date is required",
    });
  }

  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: "At least one family member is required",
    });
  }

  const uniqueMemberIds = [
    ...new Set(memberIds.map((id) => Number(id))),
  ].filter((id) => Number.isInteger(id) && id > 0);

  if (uniqueMemberIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: "At least one valid family member is required",
    });
  }

  const placeholders = uniqueMemberIds.map(() => "?").join(",");

  const validMembers = db
    .prepare(`
      SELECT id
      FROM family_members
      WHERE id IN (${placeholders})
        AND is_active = 1
    `)
    .all(...uniqueMemberIds);

  if (validMembers.length !== uniqueMemberIds.length) {
    return res.status(400).json({
      success: false,
      error: "One or more family members are invalid",
    });
  }

  const createEvent = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO events (
          title,
          description,
          start_date,
          start_time,
          end_date,
          end_time,
          all_day,
          location,
          category
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        title.trim(),
        description,
        startDate,
        allDay ? null : startTime,
        endDate,
        allDay ? null : endTime,
        allDay ? 1 : 0,
        location,
        category
      );

    const eventId = Number(result.lastInsertRowid);

    const insertMember = db.prepare(`
      INSERT INTO event_members (
        event_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (const memberId of uniqueMemberIds) {
      insertMember.run(eventId, memberId);
    }

    return eventId;
  });

  const eventId = createEvent();
  const event = getEventById(eventId);

  res.status(201).json({
    success: true,
    event,
  });
});

router.put("/:id", (req, res) => {
  const eventId = Number(req.params.id);

  const existingEvent = getEventById(eventId);

  if (!existingEvent) {
    return res.status(404).json({
      success: false,
      error: "Event not found",
    });
  }

  const {
    title,
    description = null,
    startDate,
    startTime = null,
    endDate = null,
    endTime = null,
    allDay = false,
    location = null,
    category = "other",
    memberIds = [],
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  if (!startDate) {
    return res.status(400).json({
      success: false,
      error: "Start date is required",
    });
  }

  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({
      success: false,
      error: "At least one family member is required",
    });
  }

  const uniqueMemberIds = [
    ...new Set(memberIds.map((id) => Number(id))),
  ].filter((id) => Number.isInteger(id) && id > 0);

  const placeholders = uniqueMemberIds.map(() => "?").join(",");

  const validMembers = db
    .prepare(`
      SELECT id
      FROM family_members
      WHERE id IN (${placeholders})
        AND is_active = 1
    `)
    .all(...uniqueMemberIds);

  if (validMembers.length !== uniqueMemberIds.length) {
    return res.status(400).json({
      success: false,
      error: "One or more family members are invalid",
    });
  }

  const updateEvent = db.transaction(() => {
    db.prepare(`
      UPDATE events
      SET
        title = ?,
        description = ?,
        start_date = ?,
        start_time = ?,
        end_date = ?,
        end_time = ?,
        all_day = ?,
        location = ?,
        category = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title.trim(),
      description,
      startDate,
      allDay ? null : startTime,
      endDate,
      allDay ? null : endTime,
      allDay ? 1 : 0,
      location,
      category,
      eventId
    );

    db.prepare(`
      DELETE FROM event_members
      WHERE event_id = ?
    `).run(eventId);

    const insertMember = db.prepare(`
      INSERT INTO event_members (
        event_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (const memberId of uniqueMemberIds) {
      insertMember.run(eventId, memberId);
    }
  });

  updateEvent();

  res.json({
    success: true,
    event: getEventById(eventId),
  });
});

router.delete("/:id", (req, res) => {
  const eventId = Number(req.params.id);

  const existingEvent = getEventById(eventId);

  if (!existingEvent) {
    return res.status(404).json({
      success: false,
      error: "Event not found",
    });
  }

  db.prepare(`
    DELETE FROM events
    WHERE id = ?
  `).run(eventId);

  res.json({
    success: true,
  });
});

module.exports = router;