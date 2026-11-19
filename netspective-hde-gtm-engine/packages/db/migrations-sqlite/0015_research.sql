-- Interim SQLite migration (ADR-015), feature 004. Approved research sources, runs, fetch records,
-- findings and schedules. No column holds full page text.
CREATE TABLE research_source_rule (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL CHECK (kind IN ('analyst_capture','public_org_site','public_regulatory','public_procurement')),
  match_type          TEXT NOT NULL CHECK (match_type IN ('host','host_suffix')),
  pattern             TEXT NOT NULL CHECK (length(pattern) BETWEEN 3 AND 253 AND pattern NOT GLOB '*[^a-z0-9.-]*'),
  status              TEXT NOT NULL CHECK (status IN ('enabled','disabled')),
  signal_source_kind  TEXT NOT NULL CHECK (signal_source_kind IN ('official_publication','buyer_statement','third_party',
    'analyst_observation','provider','first_party','other')),
  created_by          TEXT,
  created_at          TEXT NOT NULL,
  status_label        TEXT NOT NULL DEFAULT 'hypothesis',
  UNIQUE (match_type, pattern)
);
CREATE TRIGGER research_source_rule_no_delete BEFORE DELETE ON research_source_rule
BEGIN SELECT RAISE(ABORT, 'research source rules are never deleted'); END;

CREATE TABLE research_run (
  id                        TEXT PRIMARY KEY,
  account_id                TEXT NOT NULL REFERENCES account (id),
  started_by                TEXT NOT NULL,
  trigger                   TEXT NOT NULL CHECK (trigger IN ('manual','schedule')),
  state                     TEXT NOT NULL CHECK (state IN ('queued','running','completed','budget_reached','needs_attention','failed','cancelled')),
  max_sources               INTEGER NOT NULL CHECK (max_sources BETWEEN 1 AND 25),
  max_cost_micros           INTEGER NOT NULL CHECK (max_cost_micros > 0),
  reserved_micros           INTEGER NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
  cost_micros               INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
  input_tokens              INTEGER NOT NULL DEFAULT 0,
  output_tokens             INTEGER NOT NULL DEFAULT 0,
  sources_read              INTEGER NOT NULL DEFAULT 0,
  dropped_uncited           INTEGER NOT NULL DEFAULT 0,
  dropped_unsupported       INTEGER NOT NULL DEFAULT 0,
  dropped_protected         INTEGER NOT NULL DEFAULT 0,
  dropped_taxonomy          INTEGER NOT NULL DEFAULT 0,
  injection_flags           INTEGER NOT NULL DEFAULT 0,
  retries                   INTEGER NOT NULL DEFAULT 0,
  icp_excluded              INTEGER NOT NULL DEFAULT 0 CHECK (icp_excluded IN (0,1)),
  stop_reason               TEXT CHECK (stop_reason IS NULL OR stop_reason IN ('max_sources','max_cost','account_cap','cancelled','invalid_output','provider_error')),
  requested_sources         TEXT NOT NULL DEFAULT '[]',
  summary_json              TEXT,
  summary_prompt_version_id TEXT REFERENCES prompt_version (id),
  attention_ack_by          TEXT,
  attention_ack_at          TEXT,
  attention_note            TEXT,
  correlation_id            TEXT,
  created_at                TEXT NOT NULL,
  started_at                TEXT,
  finished_at               TEXT,
  CHECK (cost_micros <= max_cost_micros),
  CHECK (state NOT IN ('completed','budget_reached') OR summary_json IS NOT NULL)
);
CREATE UNIQUE INDEX research_run_one_active ON research_run (account_id) WHERE state IN ('queued','running');
CREATE INDEX research_run_account ON research_run (account_id, created_at);
CREATE INDEX research_run_state ON research_run (state, created_at);

CREATE TABLE research_source_fetch (
  id                 TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL REFERENCES research_run (id),
  address            TEXT NOT NULL,
  address_normalised TEXT NOT NULL,
  final_address      TEXT,
  rule_id            TEXT REFERENCES research_source_rule (id),
  outcome            TEXT NOT NULL CHECK (outcome IN ('processed','unchanged_skipped','refused_unapproved','refused_redirect',
    'blocked_by_guard','unreachable','too_large_truncated','duplicate_in_run','budget_skipped')),
  http_status        INTEGER,
  content_sha256     TEXT,
  size_bytes         INTEGER,
  truncated          INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
  injection_rule_ids TEXT NOT NULL DEFAULT '[]',
  flagged            INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0,1)),
  permitted_excerpt  TEXT,
  fetched_at         TEXT NOT NULL
);
CREATE INDEX research_source_fetch_run ON research_source_fetch (run_id);
CREATE INDEX research_source_fetch_cache ON research_source_fetch (address_normalised, fetched_at);

CREATE TABLE research_finding (
  id                     TEXT PRIMARY KEY,
  run_id                 TEXT NOT NULL REFERENCES research_run (id),
  fetch_id               TEXT REFERENCES research_source_fetch (id),
  kind                   TEXT NOT NULL CHECK (kind IN ('fact','inference','unknown','contradiction')),
  topic                  TEXT NOT NULL CHECK (topic IN ('data_architecture','source_systems','budget','project_status','buying_authority','other')),
  statement              TEXT NOT NULL CHECK (length(statement) <= 500),
  supporting_text        TEXT CHECK (supporting_text IS NULL OR length(supporting_text) <= 240),
  supporting_text_sha256 TEXT,
  basis_finding_ids      TEXT NOT NULL DEFAULT '[]',
  second_fetch_id        TEXT REFERENCES research_source_fetch (id),
  type_key               TEXT,
  extraction_confidence  TEXT NOT NULL CHECK (extraction_confidence IN ('low','medium','high')),
  verified               INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  signal_id              TEXT REFERENCES signal (id),
  signal_refusal_codes   TEXT NOT NULL DEFAULT '[]',
  carried_over_from_run  TEXT,
  created_at             TEXT NOT NULL,
  CHECK (fetch_id IS NOT NULL OR kind = 'unknown'),
  CHECK (kind <> 'fact' OR topic = 'other' OR verified = 1),
  CHECK (verified = 0 OR supporting_text_sha256 IS NOT NULL OR kind <> 'fact')
);
CREATE INDEX research_finding_run ON research_finding (run_id);
CREATE INDEX research_finding_fetch ON research_finding (fetch_id);

CREATE TABLE research_schedule (
  account_id  TEXT PRIMARY KEY REFERENCES account (id),
  cadence     TEXT NOT NULL CHECK (cadence IN ('weekly','monthly')),
  next_run_at TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
