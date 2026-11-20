-- Interim SQLite migration (ADR-015), feature 005. Claims, evidence, two-person reviews, false-positive
-- dispositions and the versioned restricted phrase list (ADR-019). `needs_review` is computed at read
-- time from the evidence and has no column. Reviews, dispositions and phrase list versions are append-only.
CREATE TABLE restricted_phrase_list (
  version     INTEGER PRIMARY KEY CHECK (version >= 1),
  rules_json  TEXT NOT NULL,
  owner       TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  note        TEXT,
  CHECK (reviewed_by <> created_by)
);
CREATE TRIGGER restricted_phrase_list_no_update BEFORE UPDATE ON restricted_phrase_list
BEGIN SELECT RAISE(ABORT, 'restricted_phrase_list is append-only'); END;
CREATE TRIGGER restricted_phrase_list_no_delete BEFORE DELETE ON restricted_phrase_list
BEGIN SELECT RAISE(ABORT, 'restricted_phrase_list is append-only'); END;

CREATE TABLE claim (
  id              TEXT PRIMARY KEY,
  text            TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 600),
  declared_class  TEXT CHECK (declared_class IS NULL OR declared_class IN ('general','quantified_outcome','production_status','sla_rto','certification','tenant_isolation','legal_regulatory_compliance','ai_ready','customer_identity')),
  effective_class TEXT NOT NULL CHECK (effective_class IN ('general','quantified_outcome','production_status','sla_rto','certification','tenant_isolation','legal_regulatory_compliance','ai_ready','customer_identity')),
  status          TEXT NOT NULL CHECK (status IN ('draft','in_review','approved','rejected','withdrawn')),
  drafted_by      TEXT NOT NULL,
  drafted_at      TEXT NOT NULL,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1)
);
CREATE INDEX claim_status ON claim (status);

CREATE TABLE claim_evidence (
  id           TEXT PRIMARY KEY,
  claim_id     TEXT NOT NULL REFERENCES claim (id),
  kind         TEXT NOT NULL CHECK (kind IN ('document','published_page','internal_record','approved_case_study')),
  reference    TEXT NOT NULL CHECK (length(reference) >= 1),
  owner        TEXT NOT NULL,
  added_by     TEXT NOT NULL,
  added_at     TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  withdrawn_at TEXT,
  withdrawn_by TEXT,
  CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL))
);
CREATE INDEX claim_evidence_claim ON claim_evidence (claim_id);
-- Evidence is withdrawn once by setting the two withdrawn columns; nothing else may change.
CREATE TRIGGER claim_evidence_guard_update BEFORE UPDATE ON claim_evidence
WHEN OLD.withdrawn_at IS NOT NULL
  OR NEW.id <> OLD.id OR NEW.claim_id <> OLD.claim_id OR NEW.kind <> OLD.kind
  OR NEW.reference <> OLD.reference OR NEW.owner <> OLD.owner OR NEW.added_by <> OLD.added_by
  OR NEW.added_at <> OLD.added_at OR NEW.expires_at <> OLD.expires_at
BEGIN SELECT RAISE(ABORT, 'claim_evidence may only be withdrawn once'); END;
CREATE TRIGGER claim_evidence_no_delete BEFORE DELETE ON claim_evidence
BEGIN SELECT RAISE(ABORT, 'claim_evidence is never deleted'); END;

CREATE TABLE claim_review (
  id          TEXT PRIMARY KEY,
  claim_id    TEXT NOT NULL REFERENCES claim (id),
  decision    TEXT NOT NULL CHECK (decision IN ('approve','reject')),
  reviewer_id TEXT NOT NULL,
  note        TEXT NOT NULL CHECK (length(note) >= 3),
  decided_at  TEXT NOT NULL,
  UNIQUE (claim_id, reviewer_id, decision)
);
CREATE INDEX claim_review_claim ON claim_review (claim_id);
CREATE TRIGGER claim_review_not_drafter BEFORE INSERT ON claim_review
WHEN NEW.reviewer_id = (SELECT drafted_by FROM claim WHERE id = NEW.claim_id)
BEGIN SELECT RAISE(ABORT, 'the drafter cannot review their own claim'); END;
CREATE TRIGGER claim_review_no_update BEFORE UPDATE ON claim_review
BEGIN SELECT RAISE(ABORT, 'claim_review is append-only'); END;
CREATE TRIGGER claim_review_no_delete BEFORE DELETE ON claim_review
BEGIN SELECT RAISE(ABORT, 'claim_review is append-only'); END;

CREATE TABLE lint_disposition (
  id            TEXT PRIMARY KEY,
  sentence_hash TEXT NOT NULL,
  rule_id       TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (length(reason) >= 3),
  reviewer_id   TEXT NOT NULL,
  decided_at    TEXT NOT NULL
);
CREATE INDEX lint_disposition_sentence ON lint_disposition (sentence_hash, rule_id);
CREATE TRIGGER lint_disposition_no_update BEFORE UPDATE ON lint_disposition
BEGIN SELECT RAISE(ABORT, 'lint_disposition is append-only'); END;
CREATE TRIGGER lint_disposition_no_delete BEFORE DELETE ON lint_disposition
BEGIN SELECT RAISE(ABORT, 'lint_disposition is append-only'); END;
