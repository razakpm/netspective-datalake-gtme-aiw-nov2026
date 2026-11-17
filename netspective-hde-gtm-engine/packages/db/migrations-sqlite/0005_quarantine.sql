-- Interim SQLite migration (ADR-015). Quarantine (FR-020). Class cc (confidential commercial);
-- `content_encrypted` is the only column that may temporarily hold suspected-prohibited material, so it
-- is encrypted at the application layer, time-limited and readable only through `quarantine.review`.
CREATE TABLE quarantine_item (
  id               TEXT PRIMARY KEY,
  entry_point      TEXT NOT NULL,
  reason_rule_ids  TEXT NOT NULL,   -- JSON array of rule IDs
  guard_version    TEXT NOT NULL,
  content_encrypted BLOB,           -- NULL once purged
  content_sha256   TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('held','released','discarded')),
  created_at       TEXT NOT NULL,
  held_until       TEXT NOT NULL,
  decided_by       TEXT REFERENCES "user"(id),
  decided_at       TEXT,
  decision_reason  TEXT,
  released_consumed_at TEXT         -- a released item re-enters the pipeline once
);
CREATE INDEX quarantine_item_status ON quarantine_item (status, held_until);

CREATE TABLE quarantine_access (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES quarantine_item(id),
  actor_id    TEXT NOT NULL REFERENCES "user"(id),
  accessed_at TEXT NOT NULL,
  purpose     TEXT NOT NULL
);
