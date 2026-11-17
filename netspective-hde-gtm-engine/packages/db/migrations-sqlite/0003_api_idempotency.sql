-- Interim SQLite migration (ADR-015). API idempotency records (FR-055). Retention default 24 hours.
CREATE TABLE idempotency_record (
  id              TEXT PRIMARY KEY,
  actor_id        TEXT NOT NULL,
  route           TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  UNIQUE (actor_id, route, idempotency_key)
);
