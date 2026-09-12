const express = require("express");
const crypto = require("crypto");

const {
  syncCalendarSource,
} = require("../services/calendarSyncService");

const {
  getGoogleAuthUrl,
  getGoogleOAuthClient,
  applyGoogleConnectionCredentials,
  getGoogleAccountInfo,
} = require("../services/googleCalendarService");

const {
  encryptToken,
} = require("../services/tokenCrypto");



const db = require("../database/db");

const router = express.Router();
const pendingGoogleOAuthStates = new Map();

function cleanupExpiredGoogleOAuthStates() {
  const now = Date.now();

  for (const [state, expiry] of pendingGoogleOAuthStates) {
    if (expiry < now) {
      pendingGoogleOAuthStates.delete(state);
    }
  }
}

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

router.get("/google/connect", (req, res) => {
  try {
    cleanupExpiredGoogleOAuthStates();
    const state = crypto.randomBytes(32).toString("hex");

    pendingGoogleOAuthStates.set(
      state,
      Date.now() + 10 * 60 * 1000
    );

    const authUrl = getGoogleAuthUrl(state);

    res.json({
  success: true,
  authUrl,
});
  } catch (error) {
    console.error(
      "Failed to create Google Calendar auth URL:",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get("/google/callback", async (req, res) => {
try {
const {
  code,
  error,
  error_description,
  state,
} = req.query;

const stateExpiry =
  state
    ? pendingGoogleOAuthStates.get(state)
    : null;

if (
  !stateExpiry ||
  stateExpiry < Date.now()
) {
  if (state) {
    pendingGoogleOAuthStates.delete(state);
  }

  return res.status(400).json({
    success: false,
    error:
      "Google OAuth state is invalid or has expired",
  });
}

pendingGoogleOAuthStates.delete(state);

if (error) {
  return res.status(400).json({
    success: false,
    error,
    errorDescription:
      error_description || null,
  });
}

if (!code) {
  return res.status(400).json({
    success: false,
    error:
      "Google OAuth callback did not include a code",
  });
}

const oauth2Client = getGoogleOAuthClient();

const { tokens } =
  await oauth2Client.getToken(code);

oauth2Client.setCredentials(tokens);

const account =
  await getGoogleAccountInfo(oauth2Client);

const existingConnection = db
  .prepare(`
    SELECT *
    FROM google_calendar_connections
    WHERE google_account_id = ?
  `)
  .get(account.googleAccountId);

if (existingConnection) {
  db.prepare(`
    UPDATE google_calendar_connections
    SET
      email = ?,
      access_token = ?,
      refresh_token = ?,
      token_expiry = ?,
      scope = ?,
      token_type = ?,
      is_enabled = 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
account.email,
tokens.access_token
  ? encryptToken(tokens.access_token)
  : existingConnection.access_token,
tokens.refresh_token
  ? encryptToken(tokens.refresh_token)
  : existingConnection.refresh_token,
tokens.expiry_date || null,
    tokens.scope || null,
    tokens.token_type || null,
    existingConnection.id
  );
} else {
  db.prepare(`
    INSERT INTO google_calendar_connections (
      google_account_id,
      email,
      access_token,
      refresh_token,
      token_expiry,
      scope,
      token_type,
      is_enabled
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
account.googleAccountId,
account.email,
encryptToken(tokens.access_token),
encryptToken(tokens.refresh_token),
tokens.expiry_date || null,
    tokens.scope || null,
    tokens.token_type || null
  );
}

res.redirect(
  "http://localhost:5173/?google=connected"
);

  } catch (error) {
    console.error(
      "Google Calendar OAuth callback failed:",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.get("/google/calendars", async (req, res) => {
  try {
    const connection = db
      .prepare(`
        SELECT *
        FROM google_calendar_connections
        WHERE is_enabled = 1
        ORDER BY id ASC
        LIMIT 1
      `)
      .get();

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: "No Google Calendar connection found",
      });
    }

    const oauth2Client = getGoogleOAuthClient();

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

    const { google } = require("googleapis");

    const calendar = google.calendar({
      version: "v3",
      auth: oauth2Client,
    });

    const response =
      await calendar.calendarList.list();

    const calendars = (
      response.data.items || []
    ).map((item) => ({
      id: item.id,
      name:
        item.summaryOverride ||
        item.summary ||
        item.id,
      primary: Boolean(item.primary),
      accessRole: item.accessRole,
      colour:
        item.backgroundColor || null,
    }));

res.json({
  success: true,
  connectionId: connection.id,
  calendars,
});
  } catch (error) {
    console.error(
      "Failed to list Google calendars:",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/google/sources", (req, res) => {
  try {
    const {
      googleConnectionId,
      providerCalendarId,
      name,
      colour = null,
    } = req.body;

    if (
      !googleConnectionId ||
      !providerCalendarId ||
      !name
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Google connection, calendar ID and name are required",
      });
    }

    const connection = db
      .prepare(`
        SELECT id
        FROM google_calendar_connections
        WHERE id = ?
          AND is_enabled = 1
      `)
      .get(Number(googleConnectionId));

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: "Google Calendar connection not found",
      });
    }

    const existingSource = db
      .prepare(`
        SELECT id
        FROM calendar_sources
        WHERE source_type = 'google'
          AND google_connection_id = ?
          AND provider_calendar_id = ?
      `)
      .get(
        Number(googleConnectionId),
        String(providerCalendarId)
      );

    if (existingSource) {
      return res.status(409).json({
        success: false,
        error:
          "This Google calendar has already been added",
        sourceId: existingSource.id,
      });
    }

    const result = db
      .prepare(`
        INSERT INTO calendar_sources (
          name,
          source_type,
          source_url,
          colour,
          is_enabled,
          sync_interval_minutes,
          google_connection_id,
          provider_calendar_id,
          created_at,
          updated_at
        )
        VALUES (
          ?,
          'google',
          NULL,
          ?,
          1,
          60,
          ?,
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `)
      .run(
        String(name).trim(),
        colour ? String(colour) : null,
        Number(googleConnectionId),
        String(providerCalendarId)
      );

    res.status(201).json({
      success: true,
      sourceId: Number(result.lastInsertRowid),
      name: String(name).trim(),
      sourceType: "google",
      googleConnectionId:
        Number(googleConnectionId),
      providerCalendarId:
        String(providerCalendarId),
    });
  } catch (error) {
    console.error(
      "Failed to create Google calendar source:",
      error
    );

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


router.get("/", (req, res) => {
  try {
    const sources = db
      .prepare(`
SELECT
  id,
  name,
  source_type,
  source_url,
  colour,
  is_enabled,
  sync_interval_minutes,
  google_connection_id,
  provider_calendar_id,
  last_synced_at,
  last_sync_status,
  last_sync_error,
  created_at,
  updated_at
FROM calendar_sources
      `)
      .all();

    res.json(
      sources.map((source) => ({
        id: source.id,
        name: source.name,
        sourceType: source.source_type,
sourceUrl: source.source_url,
colour: source.colour,
isEnabled: Boolean(source.is_enabled),
syncIntervalMinutes:
  source.sync_interval_minutes,
googleConnectionId:
  source.google_connection_id,
providerCalendarId:
  source.provider_calendar_id,
        lastSyncedAt: source.last_synced_at,
        lastSyncStatus: source.last_sync_status,
        lastSyncError: source.last_sync_error,
        createdAt: source.created_at,
        updatedAt: source.updated_at,
      }))
    );
  } catch (error) {
    console.error(
      "Calendar sources load error:",
      error
    );

    res.status(500).json({
      error: "Unable to load calendar sources",
    });
  }
});

router.post("/", (req, res) => {
  try {
const {
  name,
  sourceType = "ics",
  sourceUrl = null,
  colour = null,
  isEnabled = true,
  syncIntervalMinutes = 60,
  googleConnectionId = null,
  providerCalendarId = null,
} = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        error: "Calendar source name is required",
      });
    }

    if (
  String(sourceType).toLowerCase() === "google" &&
  (!googleConnectionId || !providerCalendarId)
) {
  return res.status(400).json({
    error:
      "Google calendar sources require a Google connection and calendar ID",
  });
}

    const result = db
      .prepare(`
INSERT INTO calendar_sources (
  name,
  source_type,
  source_url,
  colour,
  is_enabled,
  sync_interval_minutes,
  google_connection_id,
  provider_calendar_id,
  created_at,
  updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
.run(
  String(name).trim(),
  String(sourceType || "ics"),
  sourceUrl ? String(sourceUrl).trim() : null,
  colour ? String(colour) : null,
  isEnabled ? 1 : 0,
  Number(syncIntervalMinutes) || 60,
  googleConnectionId
    ? Number(googleConnectionId)
    : null,
  providerCalendarId
    ? String(providerCalendarId)
    : null
);

    const source = db
      .prepare(`
        SELECT
          id,
          name,
          source_type,
          source_url,
          colour,
          is_enabled,
          sync_interval_minutes,
          google_connection_id,
          provider_calendar_id,
          last_synced_at,
          last_sync_status,
          last_sync_error,
          created_at,
          updated_at
        FROM calendar_sources
        WHERE id = ?
      `)
      .get(result.lastInsertRowid);

    res.status(201).json({
      id: source.id,
      name: source.name,
      sourceType: source.source_type,
      sourceUrl: source.source_url,
      colour: source.colour,
      isEnabled: Boolean(source.is_enabled),
syncIntervalMinutes:
  source.sync_interval_minutes,
googleConnectionId:
  source.google_connection_id,
providerCalendarId:
  source.provider_calendar_id,
lastSyncedAt: source.last_synced_at,
      lastSyncStatus: source.last_sync_status,
      lastSyncError: source.last_sync_error,
      createdAt: source.created_at,
      updatedAt: source.updated_at,
    });
  } catch (error) {
    console.error(
      "Calendar source create error:",
      error
    );

    res.status(500).json({
      error: "Unable to create calendar source",
    });
  }
});

router.put("/:id", (req, res) => {
  try {
    const sourceId = Number(req.params.id);

    if (!Number.isInteger(sourceId)) {
      return res.status(400).json({
        error: "Invalid calendar source ID",
      });
    }

    const existingSource = db
      .prepare(`
        SELECT *
        FROM calendar_sources
        WHERE id = ?
      `)
      .get(sourceId);

    if (!existingSource) {
      return res.status(404).json({
        error: "Calendar source not found",
      });
    }

const {
  name = existingSource.name,
  sourceType = existingSource.source_type,
  sourceUrl = existingSource.source_url,
  colour = existingSource.colour,
  isEnabled = Boolean(existingSource.is_enabled),
  syncIntervalMinutes =
    existingSource.sync_interval_minutes,
  googleConnectionId =
    existingSource.google_connection_id,
  providerCalendarId =
    existingSource.provider_calendar_id,
} = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        error: "Calendar source name is required",
      });
    }

    if (
  String(sourceType).toLowerCase() === "google" &&
  (!googleConnectionId || !providerCalendarId)
) {
  return res.status(400).json({
    error:
      "Google calendar sources require a Google connection and calendar ID",
  });
}

    db.prepare(`
UPDATE calendar_sources
SET
  name = ?,
  source_type = ?,
  source_url = ?,
  colour = ?,
  is_enabled = ?,
  sync_interval_minutes = ?,
  google_connection_id = ?,
  provider_calendar_id = ?,
  updated_at = CURRENT_TIMESTAMP
WHERE id = ?
    `)
    .run(
  String(name).trim(),
  String(sourceType || "ics"),
  sourceUrl ? String(sourceUrl).trim() : null,
  colour ? String(colour) : null,
  isEnabled ? 1 : 0,
  Number(syncIntervalMinutes) || 60,
  googleConnectionId
    ? Number(googleConnectionId)
    : null,
  providerCalendarId
    ? String(providerCalendarId)
    : null,
  sourceId
);

    const source = db
      .prepare(`
SELECT
  id,
  name,
  source_type,
  source_url,
  colour,
  is_enabled,
  sync_interval_minutes,
  google_connection_id,
  provider_calendar_id,
  last_synced_at,
  last_sync_status,
  last_sync_error,
  created_at,
  updated_at
FROM calendar_sources
WHERE id = ?
      `)
      .get(sourceId);

    res.json({
      id: source.id,
      name: source.name,
      sourceType: source.source_type,
      sourceUrl: source.source_url,
      colour: source.colour,
      isEnabled: Boolean(source.is_enabled),
syncIntervalMinutes:
  source.sync_interval_minutes,
googleConnectionId:
  source.google_connection_id,
providerCalendarId:
  source.provider_calendar_id,
lastSyncedAt: source.last_synced_at,
      lastSyncStatus: source.last_sync_status,
      lastSyncError: source.last_sync_error,
      createdAt: source.created_at,
      updatedAt: source.updated_at,
    });
  } catch (error) {
    console.error(
      "Calendar source update error:",
      error
    );

    res.status(500).json({
      error: "Unable to update calendar source",
    });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const sourceId = Number(req.params.id);

    if (!Number.isInteger(sourceId)) {
      return res.status(400).json({
        error: "Invalid calendar source ID",
      });
    }

    const source = db
      .prepare(`
        SELECT
          id,
          name
        FROM calendar_sources
        WHERE id = ?
      `)
      .get(sourceId);

    if (!source) {
      return res.status(404).json({
        error: "Calendar source not found",
      });
    }

const deleteSource = db.transaction(() => {
const deletedEvents = db
  .prepare(`
    DELETE FROM events
    WHERE external_calendar_id = ?
      AND source IN ('ics', 'google')
  `)
  .run(sourceId);

  db.prepare(`
    DELETE FROM calendar_sources
    WHERE id = ?
  `).run(sourceId);

  return deletedEvents.changes;
});

const deletedEventCount =
  deleteSource();

res.json({
  success: true,
  id: sourceId,
  name: source.name,
  deletedEventCount,
});
  } catch (error) {
    console.error(
      "Calendar source delete error:",
      error
    );

    res.status(500).json({
      error: "Unable to delete calendar source",
    });
  }
});

router.post("/:id/test-sync", async (req, res) => {
  try {
    const sourceId = Number(req.params.id);

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
  .get(sourceId);

    if (!source) {
      return res.status(404).json({
        success: false,
        error: "Calendar source not found",
      });
    }

if (source.source_type !== "ics") {
  return res.status(400).json({
    success: false,
    error:
      "Test sync is currently only supported for ICS calendar sources",
  });
}

if (!source.source_url) {
  return res.status(400).json({
    success: false,
    error: "ICS URL is missing",
  });
}

    const events = await fetchIcsEvents(
      source.source_url
    );

    res.json({
      success: true,
      source: {
        id: source.id,
        name: source.name,
      },
      eventCount: events.length,
      events,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "Unable to test ICS calendar",
    });
  }
});

router.post("/:id/sync", async (req, res) => {
  try {
    const sourceId = Number(req.params.id);

    if (!Number.isInteger(sourceId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid calendar source ID",
      });
    }

    const result =
      await syncCalendarSource(sourceId);

    res.json(result);
  } catch (error) {
    const statusCode =
      error.message ===
      "Calendar source not found"
        ? 404
        : 500;

    res.status(statusCode).json({
      success: false,
      error:
        error.message ||
        "Unable to sync calendar",
    });
  }
});

module.exports = router;