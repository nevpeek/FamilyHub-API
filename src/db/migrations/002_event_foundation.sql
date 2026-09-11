ALTER TABLE events ADD COLUMN address TEXT;

ALTER TABLE events ADD COLUMN notes TEXT;

ALTER TABLE events ADD COLUMN url TEXT;

ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'familyhub';

ALTER TABLE events ADD COLUMN external_calendar_id TEXT;

ALTER TABLE events ADD COLUMN external_event_id TEXT;

ALTER TABLE events ADD COLUMN sync_status TEXT;

ALTER TABLE events ADD COLUMN weather_lat REAL;

ALTER TABLE events ADD COLUMN weather_lon REAL;

ALTER TABLE events ADD COLUMN prep_time INTEGER;

ALTER TABLE events ADD COLUMN travel_time INTEGER;

ALTER TABLE events ADD COLUMN colour_override TEXT;