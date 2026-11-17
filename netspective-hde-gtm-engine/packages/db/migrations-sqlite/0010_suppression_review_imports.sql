-- Interim SQLite migration (ADR-015), feature 002. Suppression, review queue, import runs, config lists.
CREATE TABLE suppression_record (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL CHECK (scope IN ('contact','account')),
  contact_id  TEXT REFERENCES contact (id),
  account_id  TEXT REFERENCES account (id),
  email_hash  TEXT,
  action      TEXT NOT NULL CHECK (action IN ('add','lift','erase_marker')),
  reason      TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  CHECK (
    (scope = 'contact' AND (contact_id IS NOT NULL OR email_hash IS NOT NULL)) OR
    (scope = 'account' AND account_id IS NOT NULL)
  )
);
CREATE INDEX suppression_contact ON suppression_record (contact_id);
CREATE INDEX suppression_account ON suppression_record (account_id);
CREATE INDEX suppression_hash ON suppression_record (email_hash);
CREATE TRIGGER suppression_no_update BEFORE UPDATE ON suppression_record
BEGIN SELECT RAISE(ABORT, 'suppression_record is append-only'); END;
CREATE TRIGGER suppression_no_delete BEFORE DELETE ON suppression_record
BEGIN SELECT RAISE(ABORT, 'suppression_record is append-only'); END;

CREATE TABLE review_item (
  id                    TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL CHECK (kind IN ('merge_candidate','contact_conflict')),
  subject_a             TEXT NOT NULL,
  subject_b             TEXT,
  reason_codes          TEXT NOT NULL,
  score                 REAL,
  pair_key              TEXT NOT NULL,
  attribute_fingerprint TEXT NOT NULL,
  state                 TEXT NOT NULL CHECK (state IN ('open','merged','rejected','accepted')),
  proposed_at           TEXT NOT NULL,
  decided_by            TEXT,
  decided_at            TEXT,
  decision_reason       TEXT,
  proposed_values       TEXT
);
CREATE INDEX review_item_state ON review_item (state, proposed_at);
CREATE INDEX review_item_pair ON review_item (pair_key);
CREATE TRIGGER review_item_terminal BEFORE UPDATE ON review_item
WHEN OLD.state <> 'open'
BEGIN SELECT RAISE(ABORT, 'a decided review item cannot change'); END;

CREATE TABLE import_run (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('accounts','contacts')),
  file_sha256  TEXT NOT NULL,
  row_count    INTEGER NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('queued','running','completed','failed','rejected')),
  counts       TEXT NOT NULL DEFAULT '{}',
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  finished_at  TEXT,
  job_id       TEXT
);

-- No row-content column by design: reports hold outcomes and reason codes only.
CREATE TABLE import_row (
  import_run_id TEXT NOT NULL REFERENCES import_run (id),
  row_number    INTEGER NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('created','updated','unchanged','rejected','flagged','conflict')),
  reason_codes  TEXT NOT NULL DEFAULT '[]',
  entity_id     TEXT,
  matched_id    TEXT,
  PRIMARY KEY (import_run_id, row_number)
);

CREATE TABLE config_list (
  list         TEXT NOT NULL CHECK (list IN ('contact_source','permitted_basis','personal_domain','org_type')),
  value        TEXT NOT NULL,
  label        TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  status_label TEXT NOT NULL DEFAULT 'hypothesis',
  PRIMARY KEY (list, value)
);
