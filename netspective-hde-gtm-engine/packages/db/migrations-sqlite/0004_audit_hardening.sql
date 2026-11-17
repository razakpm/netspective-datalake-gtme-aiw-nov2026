-- Interim SQLite migration (ADR-015). Audit hardening, forward-only.
-- Chain columns become mandatory for new rows (existing rows, if any, are left as they are).
CREATE TRIGGER audit_event_require_hash BEFORE INSERT ON audit_event
WHEN NEW.row_hash IS NULL
BEGIN SELECT RAISE(ABORT, 'audit_event requires row_hash'); END;

-- Retention removes whole periods only, through the privileged maintenance command, which opens a
-- window here for the duration of its transaction. Postgres drops whole partitions instead.
CREATE TABLE audit_retention_window (
  start_at TEXT NOT NULL,
  end_at   TEXT NOT NULL
);

DROP TRIGGER audit_event_no_delete;
CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event
WHEN NOT EXISTS (
  SELECT 1 FROM audit_retention_window w
  WHERE OLD.occurred_at >= w.start_at AND OLD.occurred_at < w.end_at
)
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
