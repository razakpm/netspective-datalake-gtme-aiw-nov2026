-- Interim SQLite migration (ADR-015), feature 004. Hypotheses, evidence, assumptions, status decisions,
-- banded confidence and problem interpretations. No numeric confidence and no qualification, funding,
-- budget, fit or eligibility column exists.
CREATE TABLE hypothesis_category (
  key          TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  status_label TEXT NOT NULL DEFAULT 'hypothesis'
);
CREATE TABLE service_capability_provisional (
  key          TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  status_label TEXT NOT NULL DEFAULT 'hypothesis'
);

CREATE TABLE account_hypothesis (
  id                    TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL REFERENCES account (id),
  origin                TEXT NOT NULL CHECK (origin IN ('analyst','ai')),
  acceptance            TEXT NOT NULL CHECK (acceptance IN ('proposed','accepted','dismissed')),
  statement             TEXT NOT NULL CHECK (length(statement) BETWEEN 10 AND 500),
  proposed_statement    TEXT,
  category              TEXT NOT NULL REFERENCES hypothesis_category (key),
  status                TEXT CHECK (status IS NULL OR status IN ('untested','strengthening','weakening','validated','rejected','stale')),
  not_for_prioritisation INTEGER NOT NULL DEFAULT 0 CHECK (not_for_prioritisation IN (0,1)),
  confidence_band       TEXT NOT NULL CHECK (confidence_band IN ('low','medium','high')),
  confidence_explanation TEXT NOT NULL CHECK (length(confidence_explanation) BETWEEN 3 AND 500),
  proposed_by_run_id    TEXT REFERENCES research_run (id),
  ai_model              TEXT,
  ai_prompt_version_id  TEXT REFERENCES prompt_version (id),
  created_by            TEXT,
  created_at            TEXT NOT NULL,
  accepted_by           TEXT,
  accepted_at           TEXT,
  last_revived_at       TEXT,
  flagged_for_review    INTEGER NOT NULL DEFAULT 0 CHECK (flagged_for_review IN (0,1)),
  flag_reason           TEXT CHECK (flag_reason IS NULL OR flag_reason IN ('supporting_signal_rejected','supporting_signal_stale','supporting_signal_contradicted')),
  updated_at            TEXT NOT NULL,
  CHECK ((status IS NOT NULL) = (acceptance = 'accepted')),
  CHECK (origin <> 'ai' OR (ai_model IS NOT NULL AND ai_prompt_version_id IS NOT NULL AND proposed_by_run_id IS NOT NULL)),
  CHECK (origin <> 'analyst' OR (created_by IS NOT NULL AND acceptance = 'accepted'))
);
CREATE INDEX account_hypothesis_account ON account_hypothesis (account_id, acceptance, status);

CREATE TABLE hypothesis_tag (
  hypothesis_id TEXT NOT NULL REFERENCES account_hypothesis (id),
  dimension     TEXT NOT NULL CHECK (dimension IN ('icp','capability','offer')),
  value         TEXT NOT NULL,
  PRIMARY KEY (hypothesis_id, dimension, value),
  CHECK (dimension <> 'icp' OR value IN ('icp1','icp2'))
);

CREATE TABLE hypothesis_evidence (
  id             TEXT PRIMARY KEY,
  hypothesis_id  TEXT NOT NULL REFERENCES account_hypothesis (id),
  signal_id      TEXT NOT NULL REFERENCES signal (id),
  role           TEXT NOT NULL CHECK (role IN ('supporting','contradictory')),
  linked_by      TEXT,
  linked_by_type TEXT NOT NULL CHECK (linked_by_type IN ('human','ai','system')),
  linked_at      TEXT NOT NULL,
  UNIQUE (hypothesis_id, signal_id)
);
CREATE INDEX hypothesis_evidence_signal ON hypothesis_evidence (signal_id);
CREATE TRIGGER hypothesis_evidence_no_update BEFORE UPDATE ON hypothesis_evidence
BEGIN SELECT RAISE(ABORT, 'hypothesis_evidence is append-only'); END;
CREATE TRIGGER hypothesis_evidence_no_delete BEFORE DELETE ON hypothesis_evidence
BEGIN SELECT RAISE(ABORT, 'hypothesis_evidence is append-only'); END;

CREATE TABLE problem_interpretation (
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL REFERENCES account (id),
  source_signal_id     TEXT REFERENCES signal (id),
  statement_sha256     TEXT NOT NULL,
  matches_json         TEXT NOT NULL,
  questions_json       TEXT NOT NULL,
  unknowns_json        TEXT NOT NULL,
  ai_model             TEXT NOT NULL,
  ai_prompt_version_id TEXT NOT NULL REFERENCES prompt_version (id),
  requested_by         TEXT NOT NULL,
  cost_micros          INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  created_at           TEXT NOT NULL
);

CREATE TABLE hypothesis_assumption (
  id                TEXT PRIMARY KEY,
  hypothesis_id     TEXT NOT NULL REFERENCES account_hypothesis (id),
  text              TEXT NOT NULL CHECK (length(text) BETWEEN 3 AND 300),
  source            TEXT NOT NULL CHECK (source IN ('analyst','interpretation')),
  interpretation_id TEXT REFERENCES problem_interpretation (id),
  added_by          TEXT NOT NULL,
  added_at          TEXT NOT NULL
);
CREATE TRIGGER hypothesis_assumption_no_update BEFORE UPDATE ON hypothesis_assumption
BEGIN SELECT RAISE(ABORT, 'hypothesis_assumption is append-only'); END;
CREATE TRIGGER hypothesis_assumption_no_delete BEFORE DELETE ON hypothesis_assumption
BEGIN SELECT RAISE(ABORT, 'hypothesis_assumption is append-only'); END;

CREATE TABLE hypothesis_status_decision (
  id              TEXT PRIMARY KEY,
  hypothesis_id   TEXT NOT NULL REFERENCES account_hypothesis (id),
  from_status     TEXT,
  to_status       TEXT NOT NULL CHECK (to_status IN ('untested','strengthening','weakening','validated','rejected','stale')),
  note            TEXT NOT NULL CHECK (length(note) >= 3),
  decided_by      TEXT,
  decided_by_type TEXT NOT NULL CHECK (decided_by_type IN ('human','system')),
  reason_code     TEXT,
  decided_at      TEXT NOT NULL,
  CHECK (decided_by_type <> 'system' OR to_status = 'stale'),
  CHECK (decided_by_type <> 'human' OR decided_by IS NOT NULL)
);
CREATE INDEX hypothesis_status_decision_hyp ON hypothesis_status_decision (hypothesis_id, decided_at);
CREATE TRIGGER hypothesis_status_decision_no_update BEFORE UPDATE ON hypothesis_status_decision
BEGIN SELECT RAISE(ABORT, 'hypothesis_status_decision is append-only'); END;
CREATE TRIGGER hypothesis_status_decision_no_delete BEFORE DELETE ON hypothesis_status_decision
BEGIN SELECT RAISE(ABORT, 'hypothesis_status_decision is append-only'); END;
-- Validated needs at least one supporting signal that is buyer-confirmed, approved and not purged.
CREATE TRIGGER hypothesis_validated_needs_evidence BEFORE INSERT ON hypothesis_status_decision
WHEN NEW.to_status = 'validated' AND NOT EXISTS (
  SELECT 1 FROM hypothesis_evidence e JOIN signal s ON s.id = e.signal_id
  WHERE e.hypothesis_id = NEW.hypothesis_id AND e.role = 'supporting'
    AND s.evidence_status = 'buyer_confirmed' AND s.review_status = 'approved' AND s.purged_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'validated needs a supporting approved buyer-confirmed signal'); END;

CREATE TABLE confidence_assessment (
  id               TEXT PRIMARY KEY,
  subject_type     TEXT NOT NULL CHECK (subject_type IN ('finding','hypothesis','interpretation')),
  subject_id       TEXT NOT NULL,
  dimension        TEXT NOT NULL CHECK (dimension IN ('source_reliability','extraction','entity_match','icp_fit','hypothesis',
    'capability_match','offer_fit','qualification_completeness')),
  band             TEXT NOT NULL CHECK (band IN ('low','medium','high')),
  explanation      TEXT NOT NULL CHECK (length(explanation) BETWEEN 3 AND 500),
  assessed_by_type TEXT NOT NULL CHECK (assessed_by_type IN ('human','ai','system')),
  assessed_by      TEXT,
  assessed_at      TEXT NOT NULL,
  UNIQUE (subject_type, subject_id, dimension, assessed_at)
);
CREATE TRIGGER confidence_assessment_no_update BEFORE UPDATE ON confidence_assessment
BEGIN SELECT RAISE(ABORT, 'confidence_assessment is append-only'); END;
CREATE TRIGGER confidence_assessment_no_delete BEFORE DELETE ON confidence_assessment
BEGIN SELECT RAISE(ABORT, 'confidence_assessment is append-only'); END;
