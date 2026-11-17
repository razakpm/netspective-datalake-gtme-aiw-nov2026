-- Interim SQLite migration (ADR-015), feature 002. Accounts, aliases, domains and classification history.
CREATE TABLE account (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  name_normalised TEXT NOT NULL,
  geography       TEXT,
  notes           TEXT,
  merged_into     TEXT REFERENCES account (id),
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX account_name_normalised ON account (name_normalised);

CREATE TABLE account_alias (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES account (id),
  alias            TEXT NOT NULL,
  alias_normalised TEXT NOT NULL,
  current_until    TEXT,
  source           TEXT NOT NULL CHECK (source IN ('import','rename','merge','manual')),
  created_at       TEXT NOT NULL,
  UNIQUE (account_id, alias_normalised)
);
CREATE INDEX account_alias_normalised ON account_alias (alias_normalised);

CREATE TABLE account_domain (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account (id),
  domain     TEXT NOT NULL,
  is_shared  INTEGER NOT NULL DEFAULT 0 CHECK (is_shared IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE (account_id, domain)
);
CREATE INDEX account_domain_domain ON account_domain (domain);

-- Append-only history: the current classification is the latest row.
CREATE TABLE account_classification (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL REFERENCES account (id),
  org_type           TEXT NOT NULL CHECK (org_type IN ('health_information_exchange',
    'state_medicaid_program_operator','health_system','medtech','payer','multi_site_practice',
    'biotech','other','unknown')),
  staffed_bed_count  INTEGER CHECK (staffed_bed_count IS NULL OR staffed_bed_count >= 0),
  recorded_by        TEXT,
  recorded_at        TEXT NOT NULL
);
CREATE INDEX account_classification_account ON account_classification (account_id, recorded_at);

CREATE TRIGGER account_classification_no_update BEFORE UPDATE ON account_classification
BEGIN SELECT RAISE(ABORT, 'account_classification is append-only'); END;
CREATE TRIGGER account_classification_no_delete BEFORE DELETE ON account_classification
BEGIN SELECT RAISE(ABORT, 'account_classification is append-only'); END;

-- A merged account is read-only (except being merged).
CREATE TRIGGER account_merged_readonly BEFORE UPDATE ON account
WHEN OLD.merged_into IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a merged account cannot be edited'); END;
