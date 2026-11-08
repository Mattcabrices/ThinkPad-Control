CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY,
  sampled_at TEXT NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
);
CREATE INDEX IF NOT EXISTS samples_time ON samples(sampled_at);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  command TEXT NOT NULL CHECK(json_valid(command)),
  status TEXT NOT NULL CHECK(status IN ('pending','success','error','unknown')),
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_time ON audit(requested_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)));
