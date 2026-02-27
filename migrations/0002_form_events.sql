CREATE TABLE IF NOT EXISTS form_events (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  field_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (form_id) REFERENCES forms(id)
);

CREATE INDEX IF NOT EXISTS idx_form_events_form_type_created
  ON form_events(form_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_events_form_field
  ON form_events(form_id, field_id);
