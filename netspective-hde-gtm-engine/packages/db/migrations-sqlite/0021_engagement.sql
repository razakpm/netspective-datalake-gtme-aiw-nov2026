-- Interim SQLite migration (ADR-015), feature 006. Notice versions, consent, requests from the public
-- forms and downloads of the register. A download is first-party engagement: no column here records
-- intent or qualification.
CREATE TABLE notice_version (
  id           TEXT PRIMARY KEY,
  version      INTEGER NOT NULL UNIQUE CHECK (version >= 1),
  notice_text  TEXT NOT NULL CHECK (length(notice_text) BETWEEN 1 AND 4000),
  consent_text TEXT NOT NULL CHECK (length(consent_text) BETWEEN 1 AND 600),
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  approved_by  TEXT,
  approved_at  TEXT,
  CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);
CREATE TRIGGER notice_version_text_fixed BEFORE UPDATE OF id, version, notice_text, consent_text, created_by, created_at ON notice_version
BEGIN SELECT RAISE(ABORT, 'a notice version never changes; create a new version'); END;
CREATE TRIGGER notice_version_approve_once BEFORE UPDATE OF approved_by, approved_at ON notice_version
WHEN OLD.approved_by IS NOT NULL OR NEW.approved_by IS NULL OR NEW.approved_by = OLD.created_by
BEGIN SELECT RAISE(ABORT, 'a notice version is approved once, by someone other than its author'); END;
CREATE TRIGGER notice_version_no_delete BEFORE DELETE ON notice_version
BEGIN SELECT RAISE(ABORT, 'a notice version cannot be deleted'); END;

CREATE TABLE offer_request (
  id            TEXT PRIMARY KEY,
  offer_id      TEXT NOT NULL REFERENCES engagement_offer (id),
  form_slug     TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('download','working_session','intake')),
  state         TEXT NOT NULL DEFAULT 'received' CHECK (state IN ('received','reviewed','linked','closed')),
  email         TEXT,
  email_hash    TEXT NOT NULL,
  display_name  TEXT,
  role_title    TEXT,
  org_name      TEXT,
  org_type      TEXT,
  account_id    TEXT REFERENCES account (id),
  contact_id    TEXT REFERENCES contact (id),
  flags_json    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(flags_json)),
  details_json  TEXT CHECK (details_json IS NULL OR json_valid(details_json)),
  submitted_at  TEXT NOT NULL,
  reviewed_by   TEXT,
  reviewed_at   TEXT,
  closed_reason TEXT
);
CREATE INDEX offer_request_dedupe ON offer_request (email_hash, form_slug, kind, submitted_at);
CREATE INDEX offer_request_state ON offer_request (state, submitted_at);
CREATE TRIGGER offer_request_fixed BEFORE UPDATE OF id, offer_id, form_slug, kind, email, email_hash, display_name,
  role_title, org_name, org_type, flags_json, details_json, submitted_at ON offer_request
BEGIN SELECT RAISE(ABORT, 'a request changes only in its state, link and review columns'); END;
CREATE TRIGGER offer_request_state_flow BEFORE UPDATE OF state ON offer_request
WHEN NOT ((OLD.state = 'received' AND NEW.state IN ('reviewed','linked','closed'))
  OR (OLD.state = 'reviewed' AND NEW.state IN ('linked','closed')) OR OLD.state = NEW.state)
BEGIN SELECT RAISE(ABORT, 'invalid request state change'); END;
CREATE TRIGGER offer_request_no_delete BEFORE DELETE ON offer_request
BEGIN SELECT RAISE(ABORT, 'offer_request cannot be deleted'); END;

CREATE TABLE consent_record (
  id                TEXT PRIMARY KEY,
  request_id        TEXT NOT NULL REFERENCES offer_request (id),
  contact_id        TEXT REFERENCES contact (id),
  email_hash        TEXT NOT NULL,
  notice_version_id TEXT NOT NULL REFERENCES notice_version (id),
  consent_given     INTEGER NOT NULL CHECK (consent_given IN (0,1)),
  recorded_at       TEXT NOT NULL
);
CREATE INDEX consent_record_contact ON consent_record (contact_id, recorded_at);
CREATE INDEX consent_record_hash ON consent_record (email_hash, recorded_at);
CREATE TRIGGER consent_record_no_update BEFORE UPDATE ON consent_record
BEGIN SELECT RAISE(ABORT, 'consent_record is append-only'); END;
CREATE TRIGGER consent_record_no_delete BEFORE DELETE ON consent_record
BEGIN SELECT RAISE(ABORT, 'consent_record is append-only'); END;

CREATE TABLE lead_magnet_download (
  id               TEXT PRIMARY KEY,
  request_id       TEXT NOT NULL UNIQUE REFERENCES offer_request (id),
  offer_id         TEXT NOT NULL REFERENCES engagement_offer (id),
  account_id       TEXT REFERENCES account (id),
  contact_id       TEXT REFERENCES contact (id),
  delivered        INTEGER NOT NULL CHECK (delivered IN (0,1)),
  delivery_failure TEXT,
  link_expires_at  TEXT,
  created_at       TEXT NOT NULL
);
CREATE TRIGGER lead_magnet_download_no_update BEFORE UPDATE ON lead_magnet_download
BEGIN SELECT RAISE(ABORT, 'lead_magnet_download is append-only'); END;
CREATE TRIGGER lead_magnet_download_no_delete BEFORE DELETE ON lead_magnet_download
BEGIN SELECT RAISE(ABORT, 'lead_magnet_download is append-only'); END;
