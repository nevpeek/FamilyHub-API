const ical = require("node-ical");

function formatDateOnly(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatTimeOnly(date) {
  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join(":");
}

function normaliseIcsEvent(component) {
  if (!component || component.type !== "VEVENT") {
    return null;
  }

  const start = component.start instanceof Date
    ? component.start
    : null;

  if (!start) {
    return null;
  }

const allDay =
  component.datetype === "date" ||
  component.start?.dateOnly === true;

let end = component.end instanceof Date
  ? new Date(component.end)
  : new Date(start);

if (allDay && component.end instanceof Date) {
  end.setDate(end.getDate() - 1);
}

  return {
    externalEventId:
      component.uid || null,

    title:
      component.summary?.trim() ||
      "Untitled Event",

    description:
      component.description || null,

    startDate:
      formatDateOnly(start),

    startTime:
      allDay
        ? null
        : formatTimeOnly(start),

    endDate:
      formatDateOnly(end),

    endTime:
      allDay
        ? null
        : formatTimeOnly(end),

    allDay,

    location:
      component.location || null,

    url:
      component.url || null,
  };
}

async function fetchIcsEvents(sourceUrl) {
  const parsed = await ical.async.fromURL(
    sourceUrl
  );

  const results = [];

  const rangeStart = new Date();
  rangeStart.setFullYear(
    rangeStart.getFullYear() - 1
  );

  const rangeEnd = new Date();
  rangeEnd.setFullYear(
    rangeEnd.getFullYear() + 2
  );

  for (const component of Object.values(parsed)) {
    if (
      !component ||
      component.type !== "VEVENT"
    ) {
      continue;
    }

    if (!component.rrule) {
      const event =
        normaliseIcsEvent(component);

      if (event) {
        results.push(event);
      }

      continue;
    }

    const baseStart =
      component.start instanceof Date
        ? component.start
        : null;

    const baseEnd =
      component.end instanceof Date
        ? component.end
        : baseStart;

    if (!baseStart || !baseEnd) {
      continue;
    }

const durationMs =
  baseEnd.getTime() -
  baseStart.getTime();

const occurrences =
  component.rrule.between(
    rangeStart,
    rangeEnd,
    true
  );

const isFloatingTime =
  !component.start?.tz &&
  !component.end?.tz;

for (const occurrenceStart of occurrences) {
  let adjustedStart =
    occurrenceStart;

  if (isFloatingTime) {
    adjustedStart = new Date(
      occurrenceStart.getFullYear(),
      occurrenceStart.getMonth(),
      occurrenceStart.getDate(),
      baseStart.getHours(),
      baseStart.getMinutes(),
      baseStart.getSeconds(),
      baseStart.getMilliseconds()
    );
  }

  const occurrenceEnd = new Date(
    adjustedStart.getTime() +
      durationMs
  );

  const occurrenceComponent = {
    ...component,
    rrule: null,
    start: adjustedStart,
    end: occurrenceEnd,
    uid: `${
      component.uid || "ics-event"
    }::${occurrenceStart.toISOString()}`,
  };

  const event =
    normaliseIcsEvent(
      occurrenceComponent
    );

  if (event) {
    results.push(event);
  }
}
  }

  return results;
}

module.exports = {
  fetchIcsEvents,
  normaliseIcsEvent,
};