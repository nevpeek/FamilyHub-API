const db = require("../database/db");

const {
  syncCalendarSource,
} = require("./calendarSyncService");

let schedulerRunning = false;

function parseSqliteTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(
    `${value.replace(" ", "T")}Z`
  );

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

async function runCalendarSyncCycle() {
  if (schedulerRunning) {
    return;
  }

  schedulerRunning = true;

  try {
    const sources = db
      .prepare(`
        SELECT
          id,
          name,
          sync_interval_minutes,
          last_synced_at
        FROM calendar_sources
        WHERE is_enabled = 1
      `)
      .all();

    const now = Date.now();

    for (const source of sources) {
      const intervalMinutes =
        Number(
          source.sync_interval_minutes
        ) || 60;

      const intervalMs =
        intervalMinutes * 60 * 1000;

      const lastSyncedAt =
        parseSqliteTimestamp(
          source.last_synced_at
        );

      const isDue =
        !lastSyncedAt ||
        now - lastSyncedAt.getTime() >=
          intervalMs;

      if (!isDue) {
        continue;
      }

      try {
        console.log(
          `[Calendar Sync] Syncing "${source.name}"...`
        );

        await syncCalendarSource(
          source.id
        );

        console.log(
          `[Calendar Sync] "${source.name}" complete.`
        );
      } catch (error) {
        console.error(
          `[Calendar Sync] "${source.name}" failed:`,
          error.message
        );
      }
    }
  } finally {
    schedulerRunning = false;
  }
}

function startCalendarSyncScheduler() {
  console.log(
    "[Calendar Sync] Scheduler started."
  );

  setTimeout(() => {
    runCalendarSyncCycle();
  }, 5000);

  return setInterval(() => {
    runCalendarSyncCycle();
  }, 60 * 1000);
}

module.exports = {
  startCalendarSyncScheduler,
};