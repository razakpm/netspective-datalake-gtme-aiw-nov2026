-- Interim SQLite migration (ADR-015), feature 002. ICP definitions, assessments, overrides.
CREATE TABLE icp_definition (
  id           TEXT PRIMARY KEY,
  icp          TEXT NOT NULL CHECK (icp IN ('icp1','icp2')),
  version      INTEGER NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('draft','active','retired')),
  rules        TEXT NOT NULL,
  status_label TEXT NOT NULL DEFAULT 'hypothesis',
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  activated_by TEXT,
  activated_at TEXT,
  UNIQUE (icp, version)
);
CREATE UNIQUE INDEX icp_definition_one_active ON icp_definition (icp) WHERE state = 'active';

-- Rules never change after insert; only draft -> active -> retired.
CREATE TRIGGER icp_definition_rules_immutable BEFORE UPDATE OF rules, icp, version ON icp_definition
BEGIN SELECT RAISE(ABORT, 'an ICP definition version is immutable'); END;
CREATE TRIGGER icp_definition_state_flow BEFORE UPDATE OF state ON icp_definition
WHEN NOT ((OLD.state = 'draft' AND NEW.state = 'active') OR (OLD.state = 'active' AND NEW.state = 'retired')
  OR OLD.state = NEW.state)
BEGIN SELECT RAISE(ABORT, 'invalid ICP definition state change'); END;

CREATE TABLE icp_fit_assessment (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL REFERENCES account (id),
  icp                TEXT NOT NULL CHECK (icp IN ('icp1','icp2')),
  definition_id      TEXT NOT NULL REFERENCES icp_definition (id),
  definition_version INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('strong','possible','weak','excluded','unknown')),
  confidence         TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  basis              TEXT NOT NULL CHECK (json_valid(basis) AND json_array_length(basis) >= 1),
  met                TEXT NOT NULL,
  unmet              TEXT NOT NULL,
  missing            TEXT NOT NULL,
  contradictory      TEXT NOT NULL,
  inputs_hash        TEXT NOT NULL,
  assessed_by        TEXT,
  assessed_at        TEXT NOT NULL
);
CREATE INDEX icp_fit_account ON icp_fit_assessment (account_id, icp, assessed_at);
CREATE TRIGGER icp_fit_no_update BEFORE UPDATE ON icp_fit_assessment
BEGIN SELECT RAISE(ABORT, 'icp_fit_assessment is append-only'); END;
CREATE TRIGGER icp_fit_no_delete BEFORE DELETE ON icp_fit_assessment
BEGIN SELECT RAISE(ABORT, 'icp_fit_assessment is append-only'); END;

CREATE TABLE icp_fit_ai_suggestion (
  id               TEXT PRIMARY KEY,
  assessment_id    TEXT NOT NULL REFERENCES icp_fit_assessment (id),
  suggested_status TEXT NOT NULL,
  rationale        TEXT NOT NULL,
  evidence_ids     TEXT NOT NULL,
  confidence_band  TEXT NOT NULL,
  model            TEXT NOT NULL,
  prompt_version   TEXT NOT NULL,
  review_status    TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE TABLE exclusion_override (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account (id),
  action     TEXT NOT NULL CHECK (action IN ('grant','revoke')),
  rationale  TEXT NOT NULL CHECK (length(rationale) >= 10),
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL
);
CREATE INDEX exclusion_override_account ON exclusion_override (account_id, decided_at);
CREATE TRIGGER exclusion_override_no_update BEFORE UPDATE ON exclusion_override
BEGIN SELECT RAISE(ABORT, 'exclusion_override is append-only'); END;
CREATE TRIGGER exclusion_override_no_delete BEFORE DELETE ON exclusion_override
BEGIN SELECT RAISE(ABORT, 'exclusion_override is append-only'); END;
