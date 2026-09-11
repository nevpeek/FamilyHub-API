CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_sources_google_calendar_unique
ON calendar_sources (
  google_connection_id,
  provider_calendar_id
)
WHERE source_type = 'google'
  AND google_connection_id IS NOT NULL
  AND provider_calendar_id IS NOT NULL;