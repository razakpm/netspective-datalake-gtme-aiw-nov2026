-- Interim SQLite migration (ADR-015), feature 002. Contacts, sources, roles, relationships, evidence.
CREATE TABLE contact (
  id             TEXT PRIMARY KEY,
  full_name      TEXT,
  business_email TEXT UNIQUE,
  email_hash     TEXT,
  profile_url    TEXT,
  erased_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Append-only history: current source and basis are the latest row.
CREATE TABLE contact_source (
  id                TEXT PRIMARY KEY,
  contact_id        TEXT NOT NULL REFERENCES contact (id),
  source            TEXT NOT NULL,
  basis             TEXT NOT NULL,
  documented_origin TEXT NOT NULL,
  recorded_by       TEXT,
  recorded_at       TEXT NOT NULL
);
CREATE INDEX contact_source_contact ON contact_source (contact_id, recorded_at);
CREATE TRIGGER contact_source_no_update BEFORE UPDATE ON contact_source
BEGIN SELECT RAISE(ABORT, 'contact_source is append-only'); END;

CREATE TABLE stakeholder_role (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort  INTEGER NOT NULL
);

CREATE TABLE evidence_reference (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES account (id),
  contact_id  TEXT REFERENCES contact (id),
  topic       TEXT NOT NULL CHECK (topic IN ('sender_onboarding_friction','ig_change_friction',
    'stalled_ai_pilot','demonstrated_data_problem','generic_ai_interest','mid_size_judgement',
    'economic_buyer_confirmation','other')),
  what        TEXT NOT NULL CHECK (length(what) <= 500),
  where_ref   TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  recorded_by TEXT,
  recorded_at TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('observed','buyer_confirmed','derived_interpretation',
    'ai_hypothesis','unverified_assumption','contradictory'))
);
CREATE INDEX evidence_account ON evidence_reference (account_id, topic);
CREATE TRIGGER evidence_no_update BEFORE UPDATE ON evidence_reference
BEGIN SELECT RAISE(ABORT, 'evidence_reference is append-only'); END;
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence_reference
BEGIN SELECT RAISE(ABORT, 'evidence_reference is append-only'); END;

CREATE TABLE account_contact_relationship (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES account (id),
  contact_id       TEXT NOT NULL REFERENCES contact (id),
  title_stated     TEXT,
  department       TEXT,
  role_inferred    TEXT REFERENCES stakeholder_role (key),
  role_confirmed   TEXT REFERENCES stakeholder_role (key),
  authority_status TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (authority_status IN ('unconfirmed','confirmed')),
  started_at       TEXT NOT NULL,
  ended_at         TEXT,
  end_reason       TEXT
);
CREATE UNIQUE INDEX acr_active ON account_contact_relationship (account_id, contact_id)
  WHERE ended_at IS NULL;

CREATE TABLE relationship_evidence (
  relationship_id TEXT NOT NULL REFERENCES account_contact_relationship (id),
  evidence_id     TEXT NOT NULL REFERENCES evidence_reference (id),
  purpose         TEXT NOT NULL CHECK (purpose IN ('role_confirmation','authority')),
  linked_by       TEXT,
  linked_at       TEXT NOT NULL,
  PRIMARY KEY (relationship_id, evidence_id, purpose)
);

-- FR-033: no code path may confirm an economic buyer or authority without linked buyer_confirmed evidence.
CREATE TRIGGER acr_confirm_buyer_insert BEFORE INSERT ON account_contact_relationship
WHEN NEW.role_confirmed = 'economic_buyer' OR NEW.authority_status = 'confirmed'
BEGIN SELECT RAISE(ABORT, 'confirming an economic buyer requires linked buyer_confirmed evidence'); END;

CREATE TRIGGER acr_confirm_buyer_update BEFORE UPDATE ON account_contact_relationship
WHEN (NEW.role_confirmed = 'economic_buyer' OR NEW.authority_status = 'confirmed')
  AND NOT EXISTS (
    SELECT 1 FROM relationship_evidence re
    JOIN evidence_reference e ON e.id = re.evidence_id
    WHERE re.relationship_id = NEW.id AND e.status = 'buyer_confirmed')
BEGIN SELECT RAISE(ABORT, 'confirming an economic buyer requires linked buyer_confirmed evidence'); END;
