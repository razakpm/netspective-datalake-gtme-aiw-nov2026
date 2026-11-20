-- Interim SQLite migration (ADR-015), feature 005. Offers with immutable versions and per-version status,
-- limitations and acknowledgements, capacity limits and bookings, scores, paid engagement types and
-- deliverables. No price, fee, rate or currency column exists on any table. Capacity usage is computed
-- from bookings and is never stored. A superseded version is derived, not stored.
CREATE TABLE engagement_offer (
  id                  TEXT PRIMARY KEY,
  number              INTEGER NOT NULL UNIQUE CHECK (number BETWEEN 1 AND 10),
  key                 TEXT NOT NULL UNIQUE,
  latest_version_no   INTEGER NOT NULL CHECK (latest_version_no >= 1),
  in_force_version_no INTEGER CHECK (in_force_version_no IS NULL OR in_force_version_no >= 1),
  lock_no             INTEGER NOT NULL DEFAULT 1 CHECK (lock_no >= 1),
  created_at          TEXT NOT NULL
);

CREATE TABLE offer_version (
  offer_id      TEXT NOT NULL REFERENCES engagement_offer (id),
  version_no    INTEGER NOT NULL CHECK (version_no >= 1),
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (length(reason) >= 1),
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (offer_id, version_no)
);
CREATE TRIGGER offer_version_no_update BEFORE UPDATE ON offer_version
BEGIN SELECT RAISE(ABORT, 'offer_version is append-only'); END;
CREATE TRIGGER offer_version_no_delete BEFORE DELETE ON offer_version
BEGIN SELECT RAISE(ABORT, 'offer_version is append-only'); END;

CREATE TABLE offer_version_status (
  id         TEXT PRIMARY KEY,
  offer_id   TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('draft','internally_reviewed','approved','available','withdrawn','expired')),
  changed_by TEXT NOT NULL,
  note       TEXT,
  changed_at TEXT NOT NULL,
  FOREIGN KEY (offer_id, version_no) REFERENCES offer_version (offer_id, version_no)
);
CREATE INDEX offer_version_status_version ON offer_version_status (offer_id, version_no, changed_at);
CREATE TRIGGER offer_version_status_no_update BEFORE UPDATE ON offer_version_status
BEGIN SELECT RAISE(ABORT, 'offer_version_status is append-only'); END;
CREATE TRIGGER offer_version_status_no_delete BEFORE DELETE ON offer_version_status
BEGIN SELECT RAISE(ABORT, 'offer_version_status is append-only'); END;

CREATE TABLE offer_limitation (
  id       TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES engagement_offer (id),
  key      TEXT NOT NULL,
  wording  TEXT NOT NULL CHECK (length(wording) >= 1),
  active   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (offer_id, key)
);

CREATE TABLE offer_limitation_ack (
  id              TEXT PRIMARY KEY,
  limitation_id   TEXT NOT NULL REFERENCES offer_limitation (id),
  wording_hash    TEXT NOT NULL,
  acknowledged_by TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL
);
CREATE INDEX offer_limitation_ack_limitation ON offer_limitation_ack (limitation_id, acknowledged_at);
CREATE TRIGGER offer_limitation_ack_no_update BEFORE UPDATE ON offer_limitation_ack
BEGIN SELECT RAISE(ABORT, 'offer_limitation_ack is append-only'); END;
CREATE TRIGGER offer_limitation_ack_no_delete BEFORE DELETE ON offer_limitation_ack
BEGIN SELECT RAISE(ABORT, 'offer_limitation_ack is append-only'); END;

CREATE TABLE offer_capacity (
  id             TEXT PRIMARY KEY,
  offer_id       TEXT NOT NULL REFERENCES engagement_offer (id),
  period_kind    TEXT NOT NULL CHECK (period_kind IN ('week','month')),
  limit_sessions INTEGER NOT NULL CHECK (limit_sessions >= 0),
  effective_from TEXT NOT NULL,
  set_by         TEXT NOT NULL,
  set_at         TEXT NOT NULL,
  reason         TEXT
);
CREATE INDEX offer_capacity_offer ON offer_capacity (offer_id, period_kind, effective_from);
CREATE TRIGGER offer_capacity_no_update BEFORE UPDATE ON offer_capacity
BEGIN SELECT RAISE(ABORT, 'offer_capacity is append-only'); END;
CREATE TRIGGER offer_capacity_no_delete BEFORE DELETE ON offer_capacity
BEGIN SELECT RAISE(ABORT, 'offer_capacity is append-only'); END;

CREATE TABLE offer_session_booking (
  id           TEXT PRIMARY KEY,
  offer_id     TEXT NOT NULL REFERENCES engagement_offer (id),
  external_ref TEXT,
  state        TEXT NOT NULL CHECK (state IN ('booked','held','cancelled','no_show')),
  session_date TEXT NOT NULL,
  period_start TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('manual','workshop')),
  recorded_by  TEXT NOT NULL,
  recorded_at  TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX offer_session_booking_ref ON offer_session_booking (offer_id, external_ref)
  WHERE external_ref IS NOT NULL;
CREATE INDEX offer_session_booking_period ON offer_session_booking (offer_id, period_start, state);

CREATE TABLE offer_score_criterion (
  key      TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE offer_score (
  id            TEXT PRIMARY KEY,
  offer_id      TEXT NOT NULL REFERENCES engagement_offer (id),
  criterion_key TEXT NOT NULL REFERENCES offer_score_criterion (key),
  score         INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status = 'hypothesis'),
  rationale     TEXT,
  set_by        TEXT NOT NULL,
  set_at        TEXT NOT NULL
);
CREATE INDEX offer_score_offer ON offer_score (offer_id, criterion_key, set_at);
CREATE TRIGGER offer_score_no_update BEFORE UPDATE ON offer_score
BEGIN SELECT RAISE(ABORT, 'offer_score is append-only'); END;
CREATE TRIGGER offer_score_no_delete BEFORE DELETE ON offer_score
BEGIN SELECT RAISE(ABORT, 'offer_score is append-only'); END;

CREATE TABLE paid_engagement_type (
  key             TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  weeks_min       INTEGER CHECK (weeks_min IS NULL OR weeks_min >= 1),
  weeks_max       INTEGER CHECK (weeks_max IS NULL OR weeks_max >= 1),
  scope_json      TEXT NOT NULL,
  scope_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (scope_confirmed IN (0,1)),
  status          TEXT NOT NULL CHECK (status IN ('active','inactive')),
  lock_no         INTEGER NOT NULL DEFAULT 1 CHECK (lock_no >= 1)
);

CREATE TABLE paid_engagement_deliverable (
  id          TEXT PRIMARY KEY,
  type_key    TEXT NOT NULL REFERENCES paid_engagement_type (key),
  text        TEXT NOT NULL CHECK (length(text) >= 1),
  in_source   INTEGER NOT NULL CHECK (in_source IN (0,1)),
  approval    TEXT NOT NULL CHECK (approval IN ('approved','pending_approval','rejected')),
  approved_by TEXT,
  decided_at  TEXT,
  CHECK (in_source = 1 OR approval = 'pending_approval' OR approved_by IS NOT NULL)
);
CREATE INDEX paid_engagement_deliverable_type ON paid_engagement_deliverable (type_key, approval);
