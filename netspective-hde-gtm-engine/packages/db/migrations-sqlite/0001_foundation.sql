-- Interim SQLite migration (ADR-015). The Postgres migration 0001 (T012) replaces this when a
-- Postgres 16 environment is available. Forward-only: never edit this file once merged.
-- Classification: every column here is `som` (system operational metadata) and never holds content.

CREATE TABLE audit_event (
  id             TEXT PRIMARY KEY,
  occurred_at    TEXT NOT NULL,
  actor_id       TEXT,
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('human','ai','system')),
  action         TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('success','denied','failed')),
  before_summary TEXT,
  after_summary  TEXT,
  correlation_id TEXT,
  prev_hash      TEXT,
  row_hash       TEXT
);
CREATE INDEX audit_event_entity ON audit_event (entity_type, entity_id, occurred_at);
CREATE INDEX audit_event_actor ON audit_event (actor_id, occurred_at);
CREATE INDEX audit_event_correlation ON audit_event (correlation_id);

-- Append-only: the database itself refuses changes (spec FR-011).
CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;

CREATE TABLE outbox_event (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  schema_version  INTEGER NOT NULL,
  occurred_at     TEXT NOT NULL,
  actor_id        TEXT,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('human','ai','system')),
  correlation_id  TEXT,
  causation_id    TEXT,
  idempotency_key TEXT,
  payload         TEXT NOT NULL,
  provenance      TEXT NOT NULL,
  dispatched_at   TEXT
);
CREATE INDEX outbox_event_pending ON outbox_event (dispatched_at, occurred_at);

CREATE TABLE phi_guard_decision (
  id             TEXT PRIMARY KEY,
  occurred_at    TEXT NOT NULL,
  entry_point    TEXT NOT NULL,
  decision       TEXT NOT NULL CHECK (decision IN ('reject','quarantine')),
  rule_ids       TEXT NOT NULL,   -- JSON array of rule IDs, never content
  guard_version  TEXT NOT NULL,
  correlation_id TEXT,
  entity_ref     TEXT
);
