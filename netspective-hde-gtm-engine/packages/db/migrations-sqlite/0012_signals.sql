-- Interim SQLite migration (ADR-015), feature 003. Signals (immutable observations with mutable review
-- state), provenance chain, tags, evidence links and artifact metadata.
-- No column anywhere may express funding path, ICP fit, hypothesis, intent or a buyer decision.
CREATE TABLE signal (
  id                       TEXT PRIMARY KEY,
  account_id               TEXT NOT NULL REFERENCES account (id),
  contact_id               TEXT REFERENCES contact (id),
  type_key                 TEXT NOT NULL,
  taxonomy_version         INTEGER NOT NULL,
  source_id                TEXT NOT NULL REFERENCES signal_source (id),
  source_ref               TEXT NOT NULL CHECK (length(source_ref) > 0),
  source_ref_normalised    TEXT NOT NULL,
  item_key                 TEXT,
  observation              TEXT NOT NULL CHECK (length(observation) <= 1000),
  excerpt                  TEXT CHECK (excerpt IS NULL OR length(excerpt) <= 1000),
  excerpt_withheld_reason  TEXT NOT NULL DEFAULT 'none' CHECK (excerpt_withheld_reason IN ('none','too_long','source_no_storage')),
  observed_at              TEXT NOT NULL,
  collected_at             TEXT NOT NULL,
  published_at             TEXT,
  undated                  INTEGER NOT NULL DEFAULT 0 CHECK (undated IN (0,1)),
  reliability              TEXT NOT NULL CHECK (reliability IN ('high','medium','low','unknown')),
  reliability_overridden_by TEXT,
  extraction_method        TEXT NOT NULL CHECK (extraction_method IN ('manual','provider','ai_extracted')),
  extraction_confidence    TEXT NOT NULL CHECK (extraction_confidence IN ('low','medium','high')),
  ai_model                 TEXT,
  ai_prompt_version        TEXT,
  evidence_status          TEXT NOT NULL CHECK (evidence_status IN ('observed','buyer_confirmed',
    'derived_interpretation','ai_hypothesis','unverified_assumption','contradictory')),
  review_status            TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected','contradictory')),
  new_provenance_flag      INTEGER NOT NULL DEFAULT 0 CHECK (new_provenance_flag IN (0,1)),
  freshness_days           INTEGER NOT NULL CHECK (freshness_days > 0),
  fresh_until              TEXT NOT NULL,
  freshness_state          TEXT NOT NULL DEFAULT 'fresh' CHECK (freshness_state IN ('fresh','stale')),
  funding_class            TEXT NOT NULL DEFAULT 'none' CHECK (funding_class IN ('none','context','budget_approval_evidence')),
  approval_citation        TEXT,
  regulatory_item          TEXT,
  regulatory_status        TEXT CHECK (regulatory_status IS NULL OR regulatory_status IN ('proposed','unverified','reported_final')),
  context_only             INTEGER NOT NULL DEFAULT 0 CHECK (context_only IN (0,1)),
  reverify_required        INTEGER NOT NULL DEFAULT 0 CHECK (reverify_required IN (0,1)),
  retention_policy         TEXT NOT NULL,
  retain_until             TEXT NOT NULL,
  purged_at                TEXT,
  sensitivity              TEXT NOT NULL CHECK (sensitivity IN ('public','business_contact',
    'confidential_commercial','internal_case_study_restricted','sensitive_operational_metadata')),
  content_fingerprint      TEXT NOT NULL,
  created_by               TEXT,
  created_by_type          TEXT NOT NULL CHECK (created_by_type IN ('human','ai','system')),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  FOREIGN KEY (taxonomy_version, type_key) REFERENCES signal_type (taxonomy_version, key),
  CHECK (excerpt_withheld_reason = 'none' OR excerpt IS NULL),
  CHECK (extraction_method <> 'ai_extracted' OR (ai_model IS NOT NULL AND ai_prompt_version IS NOT NULL)),
  CHECK (evidence_status <> 'buyer_confirmed' OR (extraction_method = 'manual' AND created_by_type = 'human')),
  CHECK (funding_class <> 'budget_approval_evidence' OR approval_citation IS NOT NULL)
);
CREATE UNIQUE INDEX signal_account_type_fingerprint ON signal (account_id, type_key, content_fingerprint);
CREATE UNIQUE INDEX signal_account_type_item_key ON signal (account_id, type_key, item_key) WHERE item_key IS NOT NULL;
CREATE INDEX signal_account_created ON signal (account_id, created_at);
CREATE INDEX signal_review_fresh ON signal (review_status, fresh_until);
CREATE INDEX signal_type_idx ON signal (type_key);
CREATE INDEX signal_source_idx ON signal (source_id);
CREATE INDEX signal_freshness_state ON signal (freshness_state);
CREATE INDEX signal_confidence ON signal (extraction_confidence);

-- Signals recorded by an AI or system actor always start pending.
CREATE TRIGGER signal_ai_pending BEFORE INSERT ON signal
WHEN NEW.created_by_type IN ('ai','system') AND NEW.review_status <> 'pending'
BEGIN SELECT RAISE(ABORT, 'signals from AI or system actors start pending review'); END;

-- Funding classes belong to funding types only.
CREATE TRIGGER signal_funding_kind BEFORE INSERT ON signal
WHEN NEW.funding_class <> 'none'
  AND (SELECT kind FROM signal_type WHERE taxonomy_version = NEW.taxonomy_version AND key = NEW.type_key) <> 'funding'
BEGIN SELECT RAISE(ABORT, 'funding class is only for funding signal types'); END;

-- Regulatory signals are context-only with the re-verify flag and a rule status; no other type has one.
CREATE TRIGGER signal_regulatory_kind BEFORE INSERT ON signal
WHEN (SELECT kind FROM signal_type WHERE taxonomy_version = NEW.taxonomy_version AND key = NEW.type_key) = 'regulatory'
  AND (NEW.context_only <> 1 OR NEW.reverify_required <> 1 OR NEW.regulatory_status IS NULL)
BEGIN SELECT RAISE(ABORT, 'regulatory signals are context-only, flagged for re-verification and carry a rule status'); END;
CREATE TRIGGER signal_regulatory_other BEFORE INSERT ON signal
WHEN (SELECT kind FROM signal_type WHERE taxonomy_version = NEW.taxonomy_version AND key = NEW.type_key) <> 'regulatory'
  AND NEW.regulatory_status IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a rule status is only for regulatory signals'); END;

-- Observations never change after insert; only review state, flags and retention do.
CREATE TRIGGER signal_immutable BEFORE UPDATE ON signal
WHEN NOT (OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL)
  AND (NEW.account_id IS NOT OLD.account_id
    OR (NEW.contact_id IS NOT OLD.contact_id AND NEW.contact_id IS NOT NULL)
    OR NEW.type_key IS NOT OLD.type_key
    OR NEW.taxonomy_version IS NOT OLD.taxonomy_version
    OR NEW.source_id IS NOT OLD.source_id
    OR NEW.source_ref IS NOT OLD.source_ref
    OR NEW.observation IS NOT OLD.observation
    OR NEW.excerpt IS NOT OLD.excerpt
    OR NEW.observed_at IS NOT OLD.observed_at
    OR NEW.collected_at IS NOT OLD.collected_at
    OR NEW.published_at IS NOT OLD.published_at
    OR NEW.extraction_method IS NOT OLD.extraction_method
    OR NEW.content_fingerprint IS NOT OLD.content_fingerprint)
BEGIN SELECT RAISE(ABORT, 'signal observations are immutable'); END;
CREATE TRIGGER signal_no_delete BEFORE DELETE ON signal
BEGIN SELECT RAISE(ABORT, 'signals are never deleted'); END;

CREATE TABLE signal_provenance (
  id          TEXT PRIMARY KEY,
  signal_id   TEXT NOT NULL REFERENCES signal (id),
  seq         INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('first_recorded','merged_duplicate','republication','reviewed',
    'reverified','flag_cleared','source_unavailable','contact_erased','retention')),
  actor_id    TEXT,
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('human','ai','system')),
  method      TEXT,
  source_id   TEXT REFERENCES signal_source (id),
  source_ref  TEXT,
  detail      TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  UNIQUE (signal_id, seq)
);
CREATE TRIGGER signal_provenance_no_update BEFORE UPDATE ON signal_provenance
BEGIN SELECT RAISE(ABORT, 'signal_provenance is append-only'); END;
CREATE TRIGGER signal_provenance_no_delete BEFORE DELETE ON signal_provenance
BEGIN SELECT RAISE(ABORT, 'signal_provenance is append-only'); END;

-- Advisory relevance tags: they help find signals and change no rule result.
CREATE TABLE signal_tag (
  signal_id TEXT NOT NULL REFERENCES signal (id),
  dimension TEXT NOT NULL CHECK (dimension IN ('icp','capability','offer')),
  value     TEXT NOT NULL,
  PRIMARY KEY (signal_id, dimension, value),
  CHECK (dimension <> 'icp' OR value IN ('icp1','icp2'))
);
CREATE INDEX signal_tag_lookup ON signal_tag (dimension, value);

CREATE TABLE signal_link (
  id          TEXT PRIMARY KEY,
  signal_id   TEXT NOT NULL REFERENCES signal (id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('evidence_reference','icp_fit_assessment','signal')),
  entity_id   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('supporting','contradictory')),
  linked_by   TEXT,
  linked_at   TEXT NOT NULL,
  UNIQUE (signal_id, entity_type, entity_id, role)
);
CREATE TRIGGER signal_link_no_update BEFORE UPDATE ON signal_link
BEGIN SELECT RAISE(ABORT, 'signal_link is append-only'); END;
CREATE TRIGGER signal_link_no_delete BEFORE DELETE ON signal_link
BEGIN SELECT RAISE(ABORT, 'signal_link is append-only'); END;

-- Metadata about stored items behind a signal. Content upload is out of scope for this feature.
CREATE TABLE evidence_artifact (
  id             TEXT PRIMARY KEY,
  signal_id      TEXT NOT NULL REFERENCES signal (id),
  kind           TEXT NOT NULL CHECK (kind IN ('page_capture','document','attachment_metadata')),
  storage_ref    TEXT NOT NULL,
  sha256         TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL CHECK (size_bytes >= 0),
  classification TEXT NOT NULL CHECK (classification IN ('public','business_contact','confidential_commercial',
    'internal_case_study_restricted','sensitive_operational_metadata')),
  retain_until   TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
