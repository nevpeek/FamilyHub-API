CREATE UNIQUE INDEX IF NOT EXISTS idx_events_external_calendar_event_unique
ON events (
  source,
  external_calendar_id,
  external_event_id
)
WHERE external_event_id IS NOT NULL
  AND external_calendar_id IS NOT NULL;