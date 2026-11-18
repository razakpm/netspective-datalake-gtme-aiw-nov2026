-- Interim SQLite migration (ADR-015), feature 003. Review decisions and contradiction pairs.
CREATE TABLE signal_review (
  id                    TEXT PRIMARY KEY,
  signal_id             TEXT NOT NULL REFERENCES signal (id),
  decision              TEXT NOT NULL CHECK (decision IN ('approve','reject','contradict','reverify','clear_flag')),
  reason                TEXT,
  contradicts_signal_id TEXT REFERENCES signal (id),
  reliability_set       TEXT CHECK (reliability_set IS NULL OR reliability_set IN ('high','medium','low','unknown')),
  decided_by            TEXT NOT NULL,
  decided_at            TEXT NOT NULL,
  CHECK (decision <> 'reject' OR (reason IS NOT NULL AND length(reason) >= 3)),
  CHECK (decision <> 'contradict' OR (contradicts_signal_id IS NOT NULL AND contradicts_signal_id <> signal_id)),
  CHECK (decision <> 'reverify' OR reason IS NOT NULL),
  CHECK (reliability_set IS NULL OR (reason IS NOT NULL AND length(reason) >= 3))
);
CREATE INDEX signal_review_signal ON signal_review (signal_id, decided_at);
CREATE TRIGGER signal_review_no_update BEFORE UPDATE ON signal_review
BEGIN SELECT RAISE(ABORT, 'signal_review is append-only'); END;
CREATE TRIGGER signal_review_no_delete BEFORE DELETE ON signal_review
BEGIN SELECT RAISE(ABORT, 'signal_review is append-only'); END;

CREATE TABLE signal_contradiction (
  id          TEXT PRIMARY KEY,
  signal_a    TEXT NOT NULL REFERENCES signal (id),
  signal_b    TEXT NOT NULL REFERENCES signal (id),
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  CHECK (signal_a < signal_b),
  UNIQUE (signal_a, signal_b)
);
-- Only the resolved_* columns may change, once.
CREATE TRIGGER signal_contradiction_guard BEFORE UPDATE ON signal_contradiction
WHEN OLD.resolved_at IS NOT NULL
  OR NEW.signal_a IS NOT OLD.signal_a OR NEW.signal_b IS NOT OLD.signal_b
  OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'signal_contradiction can only be resolved once'); END;
CREATE TRIGGER signal_contradiction_no_delete BEFORE DELETE ON signal_contradiction
BEGIN SELECT RAISE(ABORT, 'signal_contradiction rows are never deleted'); END;
