-- Interim SQLite migration (ADR-015). Background jobs. `failed` and `succeeded` are terminal.
CREATE TABLE job (
  id              TEXT PRIMARY KEY,
  queue           TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload         TEXT,             -- JSON, guarded; NULL once purged
  state           TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL,
  next_run_at     TEXT NOT NULL,
  scheduled_by    TEXT NOT NULL,
  last_error      TEXT,             -- JSON {code, message, stack_hash}; redacted; NULL once purged
  correlation_id  TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  finished_at     TEXT,
  UNIQUE (queue, idempotency_key)
);
CREATE INDEX job_due ON job (state, next_run_at);
CREATE INDEX job_queue_state ON job (queue, state);

-- Terminal states cannot change.
CREATE TRIGGER job_terminal_immutable BEFORE UPDATE OF state ON job
WHEN OLD.state IN ('succeeded','failed') AND NEW.state <> OLD.state
BEGIN SELECT RAISE(ABORT, 'job in a terminal state cannot change state'); END;
