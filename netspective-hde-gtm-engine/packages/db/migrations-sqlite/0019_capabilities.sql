-- Interim SQLite migration (ADR-015), feature 005. The 19 service capability slots, their evidence,
-- internal-only delivery examples and links to offers. A null attribute means "to be provided".
CREATE TABLE service_capability (
  id                     TEXT PRIMARY KEY,
  slot                   INTEGER NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 19),
  name                   TEXT,
  description            TEXT,
  input_types_json       TEXT,
  output_types_json      TEXT,
  buyer_problems_json    TEXT,
  limitations_json       TEXT,
  required_expertise     TEXT,
  potential_paid_type_key TEXT REFERENCES paid_engagement_type (key),
  public_claim_status    TEXT NOT NULL DEFAULT 'not_approved' CHECK (public_claim_status IN ('not_approved','approved')),
  public_claim_id        TEXT REFERENCES claim (id),
  lock_no                INTEGER NOT NULL DEFAULT 1 CHECK (lock_no >= 1),
  CHECK (public_claim_status <> 'approved' OR (public_claim_id IS NOT NULL AND name IS NOT NULL))
);

CREATE TABLE capability_evidence (
  id            TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES service_capability (id),
  basis_kind    TEXT NOT NULL CHECK (basis_kind IN ('delivery_record','published_material','internal_assessment')),
  reference     TEXT NOT NULL CHECK (length(reference) >= 1),
  note          TEXT,
  added_by      TEXT NOT NULL,
  added_at      TEXT NOT NULL
);
CREATE INDEX capability_evidence_capability ON capability_evidence (capability_id);

CREATE TABLE capability_delivery_example (
  id            TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES service_capability (id),
  text          TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 800),
  added_by      TEXT NOT NULL,
  added_at      TEXT NOT NULL
);
CREATE INDEX capability_delivery_example_capability ON capability_delivery_example (capability_id);

CREATE TABLE capability_offer_link (
  capability_id TEXT NOT NULL REFERENCES service_capability (id),
  offer_id      TEXT NOT NULL REFERENCES engagement_offer (id),
  PRIMARY KEY (capability_id, offer_id)
);
