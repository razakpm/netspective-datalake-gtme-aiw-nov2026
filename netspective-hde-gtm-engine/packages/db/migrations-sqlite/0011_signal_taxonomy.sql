-- Interim SQLite migration (ADR-015), feature 003. Versioned signal taxonomy and the signal source registry.
CREATE TABLE taxonomy_version (
  version      INTEGER PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('current','retired')),
  released_at  TEXT NOT NULL,
  approved_by  TEXT,
  note         TEXT,
  status_label TEXT NOT NULL DEFAULT 'hypothesis'
);
-- Exactly one current version.
CREATE UNIQUE INDEX taxonomy_version_one_current ON taxonomy_version (status) WHERE status = 'current';

CREATE TABLE signal_type (
  taxonomy_version      INTEGER NOT NULL REFERENCES taxonomy_version (version),
  key                   TEXT NOT NULL,
  category              TEXT NOT NULL CHECK (category IN ('A','B','C','D','E','F','G','H','I')),
  label                 TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('general','funding','regulatory','first_party')),
  default_freshness_days INTEGER NOT NULL CHECK (default_freshness_days > 0),
  default_reliability   TEXT NOT NULL CHECK (default_reliability IN ('high','medium','low','unknown')),
  context_only          INTEGER NOT NULL DEFAULT 0 CHECK (context_only IN (0,1)),
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  status_label          TEXT NOT NULL DEFAULT 'hypothesis',
  PRIMARY KEY (taxonomy_version, key),
  CHECK (kind <> 'regulatory' OR context_only = 1),
  CHECK ((category = 'H') = (kind = 'regulatory')),
  CHECK ((category = 'I') = (kind = 'first_party')),
  CHECK (kind <> 'funding' OR category = 'E')
);

CREATE TABLE signal_source (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  kind               TEXT NOT NULL CHECK (kind IN ('official_publication','buyer_statement','third_party',
    'analyst_observation','provider','first_party','other')),
  default_reliability TEXT NOT NULL CHECK (default_reliability IN ('high','medium','low','unknown')),
  storage_rule       TEXT NOT NULL DEFAULT 'citation_only' CHECK (storage_rule IN ('excerpt','citation_only')),
  excerpt_max_chars  INTEGER CHECK (excerpt_max_chars IS NULL OR excerpt_max_chars >= 0),
  availability       TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','unavailable')),
  unavailable_since  TEXT,
  created_by         TEXT,
  created_at         TEXT NOT NULL,
  status_label       TEXT NOT NULL DEFAULT 'hypothesis',
  CHECK (storage_rule <> 'citation_only' OR excerpt_max_chars IS NULL OR excerpt_max_chars = 0)
);

-- Sources are never deleted.
CREATE TRIGGER signal_source_no_delete BEFORE DELETE ON signal_source
BEGIN SELECT RAISE(ABORT, 'signal_source rows are never deleted'); END;
