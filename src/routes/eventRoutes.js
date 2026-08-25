const express = require("express");
const db = require("../database/db");

const router = express.Router();

const VALID_RECURRENCE_RULES = [
  "daily",
  "weekly",
  "fortnightly",
  "monthly",
  "yearly",
];

function parseDateOnly(value) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function addMonths(date, amount) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const target = new Date(Date.UTC(year, month + amount, 1));

  const lastDay = new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth() + 1,
      0
    )
  ).getUTCDate();

  target.setUTCDate(Math.min(day, lastDay));

  return target;
}

function addYears(date, amount) {
  const year = date.getUTCFullYear() + amount;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const target = new Date(Date.UTC(year, month, 1));

  const lastDay = new Date(
    Date.UTC(year, month + 1, 0)
  ).getUTCDate();

  target.setUTCDate(Math.min(day, lastDay));

  return target;
}

function getDayDifference(startDate, endDate) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  if (!start || !end) {
    return 0;
  }

  return Math.max(
    0,
    Math.round((end - start) / 86400000)
  );
}

function getNextOccurrenceDate(date, rule) {
  switch (rule) {
    case "daily":
      return addDays(date, 1);

    case "weekly":
      return addDays(date, 7);

    case "fortnightly":
      return addDays(date, 14);

    case "monthly":
      return addMonths(date, 1);

    case "yearly":
      return addYears(date, 1);

    default:
      return null;
  }
}

function getEventById(id) {
  const event = db
    .prepare(`
      SELECT
        id,
        series_id,
        title,
        description,
        start_date,
        start_time,
        end_date,
        end_time,
        all_day,
        location,
        category,
        is_recurring,
        recurrence_rule,
        recurrence_end_date,
        recurrence_count,
        recurrence_parent_date,
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
    is_recurring: Boolean(event.is_recurring),
    members,
  };
}

function createOccurrence(baseEvent, occurrenceDate) {
  const durationDays = getDayDifference(
    baseEvent.start_date,
    baseEvent.end_date || baseEvent.start_date
  );

  const occurrenceEndDate = addDays(
    occurrenceDate,
    durationDays
  );

  const occurrenceDateKey = formatDateOnly(occurrenceDate);

  return {
    ...baseEvent,
    start_date: occurrenceDateKey,
    end_date: formatDateOnly(occurrenceEndDate),
    occurrence_date: occurrenceDateKey,
    occurrence_key: `${baseEvent.id}:${occurrenceDateKey}`,
    series_event_id: baseEvent.id,
    is_occurrence: true,
  };
}

function expandRecurringEvent(baseEvent, rangeStart, rangeEnd) {
  const results = [];

  const exceptions = db
    .prepare(`
      SELECT
        occurrence_date,
        exception_type,
        replacement_event_id
      FROM event_exceptions
      WHERE event_id = ?
    `)
    .all(baseEvent.id);

  const exceptionsByDate = new Map(
    exceptions.map((exception) => [
      exception.occurrence_date,
      exception,
    ])
  );

  const firstDate = parseDateOnly(baseEvent.start_date);

  if (!firstDate) {
    return results;
  }

  const recurrenceEnd = parseDateOnly(
    baseEvent.recurrence_end_date
  );

  const maxCount =
    Number(baseEvent.recurrence_count) > 0
      ? Number(baseEvent.recurrence_count)
      : null;

  let currentDate = firstDate;
  let occurrenceNumber = 1;

  while (currentDate <= rangeEnd) {
    if (recurrenceEnd && currentDate > recurrenceEnd) {
      break;
    }

    if (maxCount && occurrenceNumber > maxCount) {
      break;
    }

   if (currentDate >= rangeStart) {
  const occurrenceDateKey = formatDateOnly(currentDate);
  const exception = exceptionsByDate.get(occurrenceDateKey);

  if (!exception) {
    results.push(
      createOccurrence(baseEvent, currentDate)
    );
  } else if (
    exception.exception_type === "replacement" &&
    exception.replacement_event_id
  ) {
    const replacementEvent = getEventById(
      exception.replacement_event_id
    );

    if (replacementEvent) {
      results.push({
        ...replacementEvent,
        occurrence_date: occurrenceDateKey,
        occurrence_key:
          `${baseEvent.id}:${occurrenceDateKey}:replacement`,
        series_event_id: baseEvent.id,
        is_occurrence: true,
        is_exception: true,
      });
    }
  }
}

    const nextDate = getNextOccurrenceDate(
      currentDate,
      baseEvent.recurrence_rule
    );

    if (!nextDate || nextDate <= currentDate) {
      break;
    }

    currentDate = nextDate;
    occurrenceNumber += 1;

    // Hard safety limit against malformed recurrence data.
    if (occurrenceNumber > 5000) {
      break;
    }
  }

  return results;
}

function normaliseRecurrence(body) {
  const recurrenceRule =
    body.recurrenceRule &&
    VALID_RECURRENCE_RULES.includes(body.recurrenceRule)
      ? body.recurrenceRule
      : null;

  const isRecurring = Boolean(recurrenceRule);

  let recurrenceEndDate =
    isRecurring && body.recurrenceEndDate
      ? body.recurrenceEndDate
      : null;

  let recurrenceCount =
    isRecurring && Number(body.recurrenceCount) > 0
      ? Math.floor(Number(body.recurrenceCount))
      : null;

  if (recurrenceCount) {
    recurrenceEndDate = null;
  }

  return {
    isRecurring,
    recurrenceRule,
    recurrenceEndDate,
    recurrenceCount,
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

  const validMembers = db
    .prepare(`
      SELECT id
      FROM family_members
      WHERE id IN (${placeholders})
        AND is_active = 1
    `)
    .all(...uniqueMemberIds);

  if (validMembers.length !== uniqueMemberIds.length) {
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
  } = req.query;

  const rangeStart =
    parseDateOnly(start) ||
    new Date(Date.UTC(1970, 0, 1));

  const rangeEnd =
    parseDateOnly(end) ||
    new Date(Date.UTC(2100, 11, 31));

  let sql = `
    SELECT DISTINCT
      e.id
    FROM events e
    WHERE e.start_date <= ?
      AND e.series_id IS NULL
  `;

  const params = [
    formatDateOnly(rangeEnd),
  ];

  sql += `
    ORDER BY e.start_date ASC
  `;

  const rows = db
    .prepare(sql)
    .all(...params);

  const events = [];

  for (const row of rows) {
    const event = getEventById(row.id);

    if (!event) {
      continue;
    }

    if (
      event.is_recurring &&
      event.recurrence_rule
    ) {
      events.push(
        ...expandRecurringEvent(
          event,
          rangeStart,
          rangeEnd
        )
      );

      continue;
    }

    const eventDate = parseDateOnly(event.start_date);

    if (
      eventDate &&
      eventDate >= rangeStart &&
      eventDate <= rangeEnd
    ) {
      events.push({
        ...event,
        occurrence_date: event.start_date,
        occurrence_key: `${event.id}:${event.start_date}`,
        series_event_id: null,
        is_occurrence: false,
      });
    }
  }

  const filteredEvents = memberId
    ? events.filter((event) =>
        event.members.some(
          (member) => member.id === Number(memberId)
        )
      )
    : events;

    filteredEvents.sort((a, b) => {
    const dateCompare =
      a.start_date.localeCompare(b.start_date);

    if (dateCompare !== 0) {
      return dateCompare;
    }

    if (a.all_day !== b.all_day) {
      return a.all_day ? -1 : 1;
    }

    const timeA = a.start_time || "23:59";
    const timeB = b.start_time || "23:59";

    const timeCompare = timeA.localeCompare(timeB);

    if (timeCompare !== 0) {
      return timeCompare;
    }

    return a.title.localeCompare(b.title);
  });

   res.json({
    success: true,
    events: filteredEvents,
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

  const memberValidation =
    validateMemberIds(memberIds);

  if (!memberValidation.valid) {
    return res.status(400).json({
      success: false,
      error: memberValidation.error,
    });
  }

  const {
    isRecurring,
    recurrenceRule,
    recurrenceEndDate,
    recurrenceCount,
  } = normaliseRecurrence(req.body);

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
          category,
          is_recurring,
          recurrence_rule,
          recurrence_end_date,
          recurrence_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        title.trim(),
        description,
        startDate,
        allDay ? null : startTime,
        endDate || startDate,
        allDay ? null : endTime,
        allDay ? 1 : 0,
        location,
        category,
        isRecurring ? 1 : 0,
        recurrenceRule,
        recurrenceEndDate,
        recurrenceCount
      );

    const eventId = Number(
      result.lastInsertRowid
    );

    const insertMember = db.prepare(`
      INSERT INTO event_members (
        event_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (const memberId of memberValidation.memberIds) {
      insertMember.run(eventId, memberId);
    }

    return eventId;
  });

  const eventId = createEvent();

  res.status(201).json({
    success: true,
    event: getEventById(eventId),
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

  const memberValidation =
    validateMemberIds(memberIds);

  if (!memberValidation.valid) {
    return res.status(400).json({
      success: false,
      error: memberValidation.error,
    });
  }

  const {
    isRecurring,
    recurrenceRule,
    recurrenceEndDate,
    recurrenceCount,
  } = normaliseRecurrence(req.body);

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
        is_recurring = ?,
        recurrence_rule = ?,
        recurrence_end_date = ?,
        recurrence_count = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title.trim(),
      description,
      startDate,
      allDay ? null : startTime,
      endDate || startDate,
      allDay ? null : endTime,
      allDay ? 1 : 0,
      location,
      category,
      isRecurring ? 1 : 0,
      recurrenceRule,
      recurrenceEndDate,
      recurrenceCount,
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

    for (const memberId of memberValidation.memberIds) {
      insertMember.run(eventId, memberId);
    }
  });

  updateEvent();

  res.json({
    success: true,
    event: getEventById(eventId),
  });
});

router.put("/:id/occurrences/:date", (req, res) => {
  const seriesEventId = Number(req.params.id);
  const occurrenceDate = req.params.date;

  const seriesEvent = getEventById(seriesEventId);

  if (!seriesEvent) {
    return res.status(404).json({
      success: false,
      error: "Event not found",
    });
  }

  if (
    !seriesEvent.is_recurring ||
    !seriesEvent.recurrence_rule
  ) {
    return res.status(400).json({
      success: false,
      error: "Event is not recurring",
    });
  }

  if (!parseDateOnly(occurrenceDate)) {
    return res.status(400).json({
      success: false,
      error: "Invalid occurrence date",
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

  const memberValidation =
    validateMemberIds(memberIds);

  if (!memberValidation.valid) {
    return res.status(400).json({
      success: false,
      error: memberValidation.error,
    });
  }

  const saveReplacement = db.transaction(() => {
    const existingException = db
      .prepare(`
        SELECT
          id,
          replacement_event_id
        FROM event_exceptions
        WHERE event_id = ?
          AND occurrence_date = ?
      `)
      .get(
        seriesEventId,
        occurrenceDate
      );

    let replacementEventId =
      existingException?.replacement_event_id
        ? Number(existingException.replacement_event_id)
        : null;

    if (replacementEventId) {
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
          series_id = ?,
          is_recurring = 0,
          recurrence_rule = NULL,
          recurrence_end_date = NULL,
          recurrence_count = NULL,
          recurrence_parent_date = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        title.trim(),
        description,
        startDate,
        allDay ? null : startTime,
        endDate || startDate,
        allDay ? null : endTime,
        allDay ? 1 : 0,
        location,
        category,
        seriesEventId,
        occurrenceDate,
        replacementEventId
      );

      db.prepare(`
        DELETE FROM event_members
        WHERE event_id = ?
      `).run(replacementEventId);
    } else {
      const result = db
        .prepare(`
          INSERT INTO events (
            series_id,
            title,
            description,
            start_date,
            start_time,
            end_date,
            end_time,
            all_day,
            location,
            category,
            is_recurring,
            recurrence_rule,
            recurrence_end_date,
            recurrence_count,
            recurrence_parent_date
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            0, NULL, NULL, NULL, ?
          )
        `)
        .run(
          seriesEventId,
          title.trim(),
          description,
          startDate,
          allDay ? null : startTime,
          endDate || startDate,
          allDay ? null : endTime,
          allDay ? 1 : 0,
          location,
          category,
          occurrenceDate
        );

      replacementEventId =
        Number(result.lastInsertRowid);
    }

    const insertMember = db.prepare(`
      INSERT INTO event_members (
        event_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (
      const memberId of memberValidation.memberIds
    ) {
      insertMember.run(
        replacementEventId,
        memberId
      );
    }

    db.prepare(`
      INSERT INTO event_exceptions (
        event_id,
        occurrence_date,
        exception_type,
        replacement_event_id
      )
      VALUES (?, ?, 'replacement', ?)

      ON CONFLICT(event_id, occurrence_date)
      DO UPDATE SET
        exception_type = 'replacement',
        replacement_event_id = excluded.replacement_event_id
    `).run(
      seriesEventId,
      occurrenceDate,
      replacementEventId
    );

    return replacementEventId;
  });

  const replacementEventId =
    saveReplacement();

  res.json({
    success: true,
    event: getEventById(replacementEventId),
    seriesEventId,
    occurrenceDate,
    status: "replaced",
  });
});

router.post("/:id/occurrences/:date/cancel", (req, res) => {
  const eventId = Number(req.params.id);
  const occurrenceDate = req.params.date;

  const event = getEventById(eventId);

  if (!event) {
    return res.status(404).json({
      success: false,
      error: "Event not found",
    });
  }

  if (!event.is_recurring || !event.recurrence_rule) {
    return res.status(400).json({
      success: false,
      error: "Event is not recurring",
    });
  }

  if (!parseDateOnly(occurrenceDate)) {
    return res.status(400).json({
      success: false,
      error: "Invalid occurrence date",
    });
  }

  db.prepare(`
    INSERT INTO event_exceptions (
      event_id,
      occurrence_date,
      exception_type,
      replacement_event_id
    )
    VALUES (?, ?, 'cancelled', NULL)
    ON CONFLICT(event_id, occurrence_date)
    DO UPDATE SET
      exception_type = 'cancelled',
      replacement_event_id = NULL
  `).run(
    eventId,
    occurrenceDate
  );

  res.json({
    success: true,
    eventId,
    occurrenceDate,
    status: "cancelled",
  });
});

router.delete("/:id/occurrences/:date/cancel", (req, res) => {
  const eventId = Number(req.params.id);
  const occurrenceDate = req.params.date;

  db.prepare(`
    DELETE FROM event_exceptions
    WHERE event_id = ?
      AND occurrence_date = ?
      AND exception_type = 'cancelled'
  `).run(
    eventId,
    occurrenceDate
  );

  res.json({
    success: true,
    eventId,
    occurrenceDate,
    status: "restored",
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