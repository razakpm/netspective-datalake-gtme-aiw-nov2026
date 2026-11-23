-- Interim SQLite migration (ADR-015), feature 006. Typed intake submissions for Offers 1 and 6. The
-- payload is validated by a typed schema before insert; no column exists for credentials, production
-- data, price or budget.
CREATE TABLE intake_submission (
  id             TEXT PRIMARY KEY,
  request_id     TEXT NOT NULL UNIQUE REFERENCES offer_request (id),
  offer_id       TEXT NOT NULL REFERENCES engagement_offer (id),
  kind           TEXT NOT NULL CHECK (kind IN ('offer_1','offer_6')),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  account_id     TEXT REFERENCES account (id),
  contact_id     TEXT REFERENCES contact (id),
  payload_json   TEXT NOT NULL CHECK (json_valid(payload_json)),
  classification TEXT NOT NULL CHECK (classification = 'non_phi'),
  submitted_at   TEXT NOT NULL,
  review_state   TEXT NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','reviewed'))
);
CREATE TRIGGER intake_submission_fixed BEFORE UPDATE OF id, request_id, offer_id, kind, schema_version,
  account_id, contact_id, payload_json, classification, submitted_at ON intake_submission
BEGIN SELECT RAISE(ABORT, 'intake_submission is append-only apart from its review state'); END;
CREATE TRIGGER intake_submission_review_flow BEFORE UPDATE OF review_state ON intake_submission
WHEN NOT (OLD.review_state = 'pending' AND NEW.review_state = 'reviewed')
BEGIN SELECT RAISE(ABORT, 'invalid intake review state change'); END;
CREATE TRIGGER intake_submission_no_delete BEFORE DELETE ON intake_submission
BEGIN SELECT RAISE(ABORT, 'intake_submission is append-only'); END;
