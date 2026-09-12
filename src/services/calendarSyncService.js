const db = require("../database/db");

const {
  fetchIcsEvents,
} = require("./icsSyncService");

const {
  getGoogleOAuthClient,
  applyGoogleConnectionCredentials,
  fetchGoogleCalendarEvents,
} = require("./googleCalendarService");

const {
  encryptToken,
} = require("./tokenCrypto");

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");
  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatLocalTime(date) {
  const hours = String(
    date.getHours()
  ).padStart(2, "0");
  const minutes = String(
    date.getMinutes()
  ).padStart(2, "0");

  return `${hours}:${minutes}`;
}

function subtractOneDay(dateString) {
  const [year, month, day] =
    dateString.split("-").map(Number);

  const date = new Date(
    year,
    month - 1,
    day
  );

  date.setDate(date.getDate() - 1);

  return formatLocalDate(date);
}

function mapGoogleEventToFamilyHub(
  googleEvent,
  source
) {
  const isAllDay = Boolean(
    googleEvent.start?.date
  );

  let startDate = null;
  let endDate = null;
  let startTime = null;
  let endTime = null;

  if (isAllDay) {
    startDate = googleEvent.start.date;

    endDate = googleEvent.end?.date
      ? subtractOneDay(
          googleEvent.end.date
        )
      : startDate;
  } else {
    const start = googleEvent.start?.dateTime
      ? new Date(
          googleEvent.start.dateTime
        )
      : null;

    const end = googleEvent.end?.dateTime
      ? new Date(
          googleEvent.end.dateTime
        )
      : null;

    if (start) {
      startDate = formatLocalDate(start);
      startTime = formatLocalTime(start);
    }

    if (end) {
      endDate = formatLocalDate(end);
      endTime = formatLocalTime(end);
    }
  }

  return {
    title:
      googleEvent.summary?.trim() ||
      "(No title)",
    startDate,
    endDate: endDate || startDate,
    startTime,
    endTime,
    allDay: isAllDay ? 1 : 0,
    address:
      googleEvent.location || null,
    notes:
      googleEvent.description || null,
    url:
      googleEvent.htmlLink || null,
    source: "google",
    externalCalendarId: source.id,
    externalEventId: googleEvent.id,
    syncStatus: "synced",
    colourOverride:
      source.colour || null,
  };
}

function markSyncFailed(sourceId, error) {
  try {
    db.prepare(`
      UPDATE calendar_sources
      SET
        last_sync_status = 'failed',
        last_sync_error = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      error?.message ||
        "Unable to sync calendar",
      Number(sourceId)
    );
  } catch (saveError) {
    console.error(
      "Unable to save calendar sync failure:",
      saveError
    );
  }
}

async function syncCalendarSource(sourceId) {
  try {
    const source = db
    .prepare(`
      SELECT
        id,
        name,
        source_type,
        source_url,
        colour,
        is_enabled,
        google_connection_id,
        provider_calendar_id
      FROM calendar_sources
      WHERE id = ?
    `)
    .get(Number(sourceId));

  if (!source) {
    throw new Error("Calendar source not found");
  }

  if (!source.is_enabled) {
    throw new Error("Calendar source is disabled");
  }

  if (
    source.source_type !== "ics" &&
    source.source_type !== "google"
  ) {
    throw new Error(
      "Unsupported calendar source type"
    );
  }

  if (
    source.source_type === "ics" &&
    !source.source_url
  ) {
    throw new Error("ICS URL is missing");
  }

  if (source.source_type === "google") {
    const connection = db
      .prepare(`
        SELECT *
        FROM google_calendar_connections
        WHERE id = ?
          AND is_enabled = 1
      `)
      .get(source.google_connection_id);

    if (!connection) {
      throw new Error(
        "Google Calendar connection not found"
      );
    }

    if (!source.provider_calendar_id) {
      throw new Error(
        "Google calendar ID is missing"
      );
    }

    const oauth2Client =
      getGoogleOAuthClient();

    applyGoogleConnectionCredentials(
      oauth2Client,
      connection,
      (tokens) => {
        db.prepare(`
          UPDATE google_calendar_connections
          SET
            access_token = COALESCE(?, access_token),
            refresh_token = COALESCE(?, refresh_token),
            token_expiry = COALESCE(?, token_expiry),
            scope = COALESCE(?, scope),
            token_type = COALESCE(?, token_type),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
  encryptToken(tokens.access_token),
  encryptToken(tokens.refresh_token),
  tokens.expiry_date || null,
  tokens.scope || null,
  tokens.token_type || null,
  connection.id
);
      }
    );

    const now = new Date();

    const windowStart = new Date(
      now.getFullYear() - 1,
      now.getMonth(),
      now.getDate()
    );

    const windowEnd = new Date(
      now.getFullYear() + 2,
      now.getMonth(),
      now.getDate()
    );

    const googleEvents =
      await fetchGoogleCalendarEvents(
        oauth2Client,
        source.provider_calendar_id,
        {
          timeMin:
            windowStart.toISOString(),
          timeMax:
            windowEnd.toISOString(),
        }
      );

    const mappedEvents =
      googleEvents.map((event) =>
        mapGoogleEventToFamilyHub(
          event,
          source
        )
      );

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let removed = 0;

    const windowStartDate =
      formatLocalDate(windowStart);

    const windowEndDate =
      formatLocalDate(windowEnd);

    const syncGoogleEvents =
      db.transaction(() => {
        const validExternalEventIds =
          new Set(
            mappedEvents
              .map(
                (event) =>
                  event.externalEventId
              )
              .filter(Boolean)
          );

        const findExisting =
          db.prepare(`
            SELECT id
            FROM events
            WHERE source = 'google'
              AND external_calendar_id = ?
              AND external_event_id = ?
            LIMIT 1
          `);

        const insertEvent =
          db.prepare(`
            INSERT INTO events (
              title,
              description,
              start_date,
              start_time,
              end_date,
              end_time,
              all_day,
              location,
              address,
              notes,
              url,
              category,
              source,
              external_calendar_id,
              external_event_id,
              sync_status,
              colour_override,
              is_recurring
            )
            VALUES (
              ?,
              NULL,
              ?, ?, ?, ?, ?,
              NULL,
              ?, ?, ?,
              'other',
              'google',
              ?, ?,
              'synced',
              ?,
              0
            )
          `);

        const updateEvent =
          db.prepare(`
            UPDATE events
            SET
              title = ?,
              description = NULL,
              start_date = ?,
              start_time = ?,
              end_date = ?,
              end_time = ?,
              all_day = ?,
              location = NULL,
              address = ?,
              notes = ?,
              url = ?,
              sync_status = 'synced',
              colour_override = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `);

        for (const event of mappedEvents) {
          if (
            !event.externalEventId ||
            !event.startDate
          ) {
            skipped += 1;
            continue;
          }

          const existing =
            findExisting.get(
              source.id,
              event.externalEventId
            );

          if (existing) {
            updateEvent.run(
              event.title,
              event.startDate,
              event.startTime,
              event.endDate ||
                event.startDate,
              event.endTime,
              event.allDay ? 1 : 0,
              event.address,
              event.notes,
              event.url,
              source.colour,
              existing.id
            );

            updated += 1;
            continue;
          }

          insertEvent.run(
            event.title,
            event.startDate,
            event.startTime,
            event.endDate ||
              event.startDate,
            event.endTime,
            event.allDay ? 1 : 0,
            event.address,
            event.notes,
            event.url,
            source.id,
            event.externalEventId,
            source.colour
          );

          created += 1;
        }

        const existingSourceEvents =
          db.prepare(`
            SELECT
              id,
              external_event_id
            FROM events
            WHERE source = 'google'
              AND external_calendar_id = ?
              AND external_event_id IS NOT NULL
              AND COALESCE(
                end_date,
                start_date
              ) >= ?
              AND start_date < ?
          `).all(
            source.id,
            windowStartDate,
            windowEndDate
          );

        const deleteStaleEvent =
          db.prepare(`
            DELETE FROM events
            WHERE id = ?
          `);

        for (
          const existingEvent
          of existingSourceEvents
        ) {
          if (
            !validExternalEventIds.has(
              existingEvent.external_event_id
            )
          ) {
            deleteStaleEvent.run(
              existingEvent.id
            );

            removed += 1;
          }
        }
      });

    syncGoogleEvents();

    db.prepare(`
      UPDATE calendar_sources
      SET
        last_synced_at = CURRENT_TIMESTAMP,
        last_sync_status = 'success',
        last_sync_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(source.id);

    return {
      success: true,
      source,
      sourceType: "google",
      eventCount: mappedEvents.length,
      created,
      updated,
      skipped,
      removed,
    };
  }

  const icsEvents = await fetchIcsEvents(
    source.source_url
  );

  if (!Array.isArray(icsEvents)) {
    throw new Error(
      "ICS calendar did not return a valid event list"
    );
  }

  const existingImportedEventCount = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM events
      WHERE source = 'ics'
        AND external_calendar_id = ?
    `)
    .get(source.id).count;

  if (
    icsEvents.length === 0 &&
    existingImportedEventCount > 0
  ) {
    throw new Error(
      "ICS calendar returned no events. Existing imported events were preserved."
    );
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let removed = 0;

  const syncEvents = db.transaction(() => {
    const validExternalEventIds = new Set(
      icsEvents
        .map(
          (event) =>
            event.externalEventId
        )
        .filter(Boolean)
    );

    const findExisting = db.prepare(`
      SELECT id
      FROM events
      WHERE source = 'ics'
        AND external_calendar_id = ?
        AND external_event_id = ?
      LIMIT 1
    `);

    const insertEvent = db.prepare(`
      INSERT INTO events (
        title,
        description,
        start_date,
        start_time,
        end_date,
        end_time,
        all_day,
        location,
        address,
        notes,
        url,
        category,
        source,
        external_calendar_id,
        external_event_id,
        sync_status,
        colour_override,
        is_recurring
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        NULL, NULL, ?,
        'other',
        'ics',
        ?, ?,
        'synced',
        ?,
        0
      )
    `);

    const updateEvent = db.prepare(`
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
        url = ?,
        sync_status = 'synced',
        colour_override = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    for (const event of icsEvents) {
      if (!event.externalEventId) {
        skipped += 1;
        continue;
      }

      const existing =
        findExisting.get(
          source.id,
          event.externalEventId
        );

      if (existing) {
        updateEvent.run(
          event.title,
          event.description,
          event.startDate,
          event.startTime,
          event.endDate ||
            event.startDate,
          event.endTime,
          event.allDay ? 1 : 0,
          event.location,
          event.url,
          source.colour,
          existing.id
        );

        updated += 1;
        continue;
      }

      insertEvent.run(
        event.title,
        event.description,
        event.startDate,
        event.startTime,
        event.endDate ||
          event.startDate,
        event.endTime,
        event.allDay ? 1 : 0,
        event.location,
        event.url,
        source.id,
        event.externalEventId,
        source.colour
      );

      created += 1;
    }

    const existingSourceEvents =
      db.prepare(`
        SELECT
          id,
          external_event_id
        FROM events
        WHERE source = 'ics'
          AND external_calendar_id = ?
          AND external_event_id IS NOT NULL
      `)
      .all(source.id);

    const deleteStaleEvent =
      db.prepare(`
        DELETE FROM events
        WHERE id = ?
      `);

    for (
      const existingEvent
      of existingSourceEvents
    ) {
      if (
        !validExternalEventIds.has(
          existingEvent.external_event_id
        )
      ) {
        deleteStaleEvent.run(
          existingEvent.id
        );

        removed += 1;
      }
    }
  });

  syncEvents();

  db.prepare(`
    UPDATE calendar_sources
    SET
      last_synced_at = CURRENT_TIMESTAMP,
      last_sync_status = 'success',
      last_sync_error = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(source.id);

    return {
      success: true,
      source,
      sourceType: "ics",
      eventCount: icsEvents.length,
      created,
      updated,
      skipped,
      removed,
    };
  } catch (error) {
    markSyncFailed(sourceId, error);
    throw error;
  }
}

module.exports = {
  syncCalendarSource,
};