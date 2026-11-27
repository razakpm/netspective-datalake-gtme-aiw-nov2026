-- Interim SQLite migration (ADR-015), feature 007 (ADR-021). Workshops, their history, participants,
-- delivery effort, artifacts and preparation briefs. No column holds a price, a credential, a contact
-- detail or a qualification decision.
CREATE TABLE workshop (
  id               TEXT PRIMARY KEY,
  request_id       TEXT NOT NULL REFERENCES offer_request (id),
  offer_id         TEXT NOT NULL REFERENCES engagement_offer (id),
  intake_id        TEXT NOT NULL REFERENCES intake_submission (id),
  account_id       TEXT NOT NULL REFERENCES account (id),
  contact_id       TEXT NOT NULL REFERENCES contact (id),
  state            TEXT NOT NULL CHECK (state IN
    ('requested','booked','held','findings_recorded','closed','cancelled','no_show')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
  scheduled_at     TEXT,
  session_date     TEXT,
  booking_id       TEXT REFERENCES offer_session_booking (id),
  booking_route    TEXT CHECK (booking_route IN ('manual','calendar')),
  calendar_ref     TEXT,
  lock_no          INTEGER NOT NULL CHECK (lock_no >= 1),
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  closed_at        TEXT,
  -- No booking detail when requested; all of them from booked on. A workshop cancelled before it was
  -- booked has none.
  CHECK (
    (state IN ('requested','cancelled')
      AND scheduled_at IS NULL AND session_date IS NULL AND booking_id IS NULL AND booking_route IS NULL)
    OR (state <> 'requested'
      AND scheduled_at IS NOT NULL AND session_date IS NOT NULL AND booking_id IS NOT NULL
      AND booking_route IS NOT NULL)
  ),
  CHECK ((state IN ('closed','cancelled','no_show')) = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX workshop_open_request ON workshop (request_id)
  WHERE state IN ('requested','booked','held','findings_recorded');
CREATE INDEX workshop_state ON workshop (state, scheduled_at);
CREATE INDEX workshop_offer ON workshop (offer_id, state);
CREATE TRIGGER workshop_fixed BEFORE UPDATE OF id, request_id, offer_id, intake_id, account_id,
  contact_id, created_by, created_at ON workshop
BEGIN SELECT RAISE(ABORT, 'what a workshop is about never changes'); END;
CREATE TRIGGER workshop_final BEFORE UPDATE OF state ON workshop
WHEN OLD.state IN ('closed','cancelled','no_show') AND NEW.state <> OLD.state
BEGIN SELECT RAISE(ABORT, 'a final workshop state never changes'); END;
CREATE TRIGGER workshop_no_delete BEFORE DELETE ON workshop
BEGIN SELECT RAISE(ABORT, 'a workshop cannot be deleted'); END;

CREATE TABLE workshop_state_history (
  id             TEXT PRIMARY KEY,
  workshop_id    TEXT NOT NULL REFERENCES workshop (id),
  from_state     TEXT CHECK (from_state IN
    ('requested','booked','held','findings_recorded','closed','cancelled','no_show')),
  to_state       TEXT NOT NULL CHECK (to_state IN
    ('requested','booked','held','findings_recorded','closed','cancelled','no_show')),
  note           TEXT CHECK (note IS NULL OR length(note) >= 3),
  scheduled_from TEXT,
  scheduled_to   TEXT,
  changed_by     TEXT NOT NULL,
  changed_at     TEXT NOT NULL,
  CHECK (to_state NOT IN ('cancelled','no_show','closed') OR note IS NOT NULL),
  -- A booked to booked row is a reschedule and needs its reason.
  CHECK (NOT (from_state IS 'booked' AND to_state = 'booked') OR note IS NOT NULL)
);
CREATE INDEX workshop_state_history_workshop ON workshop_state_history (workshop_id, changed_at);
CREATE TRIGGER workshop_state_history_no_update BEFORE UPDATE ON workshop_state_history
BEGIN SELECT RAISE(ABORT, 'workshop_state_history is append-only'); END;
CREATE TRIGGER workshop_state_history_no_delete BEFORE DELETE ON workshop_state_history
BEGIN SELECT RAISE(ABORT, 'workshop_state_history is append-only'); END;

CREATE TABLE workshop_participant (
  id           TEXT PRIMARY KEY,
  workshop_id  TEXT NOT NULL REFERENCES workshop (id),
  side         TEXT NOT NULL CHECK (side IN ('buyer','delivery')),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  role_title   TEXT CHECK (role_title IS NULL OR length(role_title) <= 120),
  contact_id   TEXT REFERENCES contact (id),
  user_id      TEXT,
  added_by     TEXT NOT NULL,
  added_at     TEXT NOT NULL,
  removed_at   TEXT,
  removed_by   TEXT,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
CREATE INDEX workshop_participant_workshop ON workshop_participant (workshop_id, added_at);
CREATE TRIGGER workshop_participant_fixed BEFORE UPDATE OF id, workshop_id, side, display_name,
  role_title, contact_id, user_id, added_by, added_at ON workshop_participant
BEGIN SELECT RAISE(ABORT, 'a participant can only be removed'); END;
CREATE TRIGGER workshop_participant_remove_once BEFORE UPDATE OF removed_at, removed_by
  ON workshop_participant
WHEN OLD.removed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a participant is removed once'); END;
CREATE TRIGGER workshop_participant_no_delete BEFORE DELETE ON workshop_participant
BEGIN SELECT RAISE(ABORT, 'a participant cannot be deleted'); END;

CREATE TABLE delivery_effort (
  id            TEXT PRIMARY KEY,
  workshop_id   TEXT NOT NULL REFERENCES workshop (id),
  prep_hours    REAL NOT NULL CHECK (prep_hours BETWEEN 0 AND 80),
  session_hours REAL NOT NULL CHECK (session_hours BETWEEN 0 AND 24),
  people        INTEGER NOT NULL CHECK (typeof(people) = 'integer' AND people BETWEEN 1 AND 20),
  recorded_by   TEXT NOT NULL,
  recorded_at   TEXT NOT NULL
);
CREATE INDEX delivery_effort_workshop ON delivery_effort (workshop_id, recorded_at);
CREATE TRIGGER delivery_effort_no_update BEFORE UPDATE ON delivery_effort
BEGIN SELECT RAISE(ABORT, 'delivery_effort is append-only'); END;
CREATE TRIGGER delivery_effort_no_delete BEFORE DELETE ON delivery_effort
BEGIN SELECT RAISE(ABORT, 'delivery_effort is append-only'); END;

-- Held content is never stored here: it lives only in the encrypted quarantine item.
CREATE TABLE workshop_artifact (
  id                 TEXT PRIMARY KEY,
  workshop_id        TEXT NOT NULL REFERENCES workshop (id),
  kind               TEXT NOT NULL,
  title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  reference          TEXT CHECK (reference IS NULL OR length(reference) <= 500),
  storage_key        TEXT,
  size_bytes         INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  content_sha256     TEXT,
  supplied_by_label  TEXT CHECK (supplied_by_label IS NULL OR length(supplied_by_label) <= 120),
  recorded_by        TEXT NOT NULL,
  recorded_at        TEXT NOT NULL,
  classification     TEXT NOT NULL CHECK (classification = 'non_phi'),
  state              TEXT NOT NULL CHECK (state IN ('received','held','released','discarded')),
  quarantine_item_id TEXT,
  hold_rule_ids_json TEXT CHECK (hold_rule_ids_json IS NULL OR json_valid(hold_rule_ids_json)),
  decided_by         TEXT,
  decided_at         TEXT,
  file_deleted_at    TEXT,
  CHECK (state NOT IN ('received','released') OR reference IS NOT NULL OR storage_key IS NOT NULL),
  CHECK (state <> 'held' OR (storage_key IS NULL AND content_sha256 IS NULL))
);
CREATE INDEX workshop_artifact_workshop ON workshop_artifact (workshop_id, recorded_at);
CREATE TRIGGER workshop_artifact_fixed BEFORE UPDATE OF id, workshop_id, kind, title, reference,
  supplied_by_label, recorded_by, recorded_at, classification, hold_rule_ids_json ON workshop_artifact
BEGIN SELECT RAISE(ABORT, 'an artifact changes only its decision and file columns'); END;
CREATE TRIGGER workshop_artifact_state_flow BEFORE UPDATE OF state ON workshop_artifact
WHEN NOT (OLD.state = 'held' AND NEW.state IN ('released','discarded'))
BEGIN SELECT RAISE(ABORT, 'invalid artifact state change'); END;
CREATE TRIGGER workshop_artifact_deleted_once BEFORE UPDATE OF file_deleted_at ON workshop_artifact
WHEN OLD.file_deleted_at IS NOT NULL OR NEW.file_deleted_at IS NULL
BEGIN SELECT RAISE(ABORT, 'an artifact file is deleted once'); END;
CREATE TRIGGER workshop_artifact_no_delete BEFORE DELETE ON workshop_artifact
BEGIN SELECT RAISE(ABORT, 'an artifact record cannot be deleted'); END;

CREATE TABLE workshop_brief (
  id               TEXT PRIMARY KEY,
  workshop_id      TEXT NOT NULL REFERENCES workshop (id),
  version_no       INTEGER NOT NULL CHECK (version_no >= 1),
  content_json     TEXT NOT NULL CHECK (json_valid(content_json)),
  source           TEXT NOT NULL CHECK (source IN ('baseline','model')),
  ai_invocation_id TEXT REFERENCES ai_invocation (id),
  model            TEXT,
  prompt_version   TEXT,
  schema_version   TEXT,
  confidence       TEXT CHECK (confidence IN ('low','medium','high')),
  rationale        TEXT CHECK (rationale IS NULL OR length(rationale) <= 300),
  review_status    TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed','reviewed')),
  reviewed_by      TEXT,
  reviewed_at      TEXT,
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  UNIQUE (workshop_id, version_no),
  CHECK (ai_invocation_id IS NULL OR source = 'model'),
  CHECK ((review_status = 'reviewed') = (reviewed_by IS NOT NULL)),
  CHECK ((review_status = 'reviewed') = (reviewed_at IS NOT NULL))
);
CREATE TRIGGER workshop_brief_fixed BEFORE UPDATE OF id, workshop_id, version_no, content_json, source,
  ai_invocation_id, model, prompt_version, schema_version, confidence, rationale, created_by, created_at
  ON workshop_brief
BEGIN SELECT RAISE(ABORT, 'workshop_brief is append-only apart from its review'); END;
CREATE TRIGGER workshop_brief_review_once BEFORE UPDATE OF review_status, reviewed_by, reviewed_at
  ON workshop_brief
WHEN OLD.review_status = 'reviewed'
BEGIN SELECT RAISE(ABORT, 'a brief is reviewed once'); END;
CREATE TRIGGER workshop_brief_no_delete BEFORE DELETE ON workshop_brief
BEGIN SELECT RAISE(ABORT, 'workshop_brief is append-only'); END;
