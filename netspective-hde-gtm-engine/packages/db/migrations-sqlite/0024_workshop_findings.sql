-- Interim SQLite migration (ADR-015), feature 007 (ADR-021). Typed findings (versioned), the buyer
-- output revisions and the record of sharing. Nothing here sends anything.
CREATE TABLE workshop_finding (
  id                TEXT PRIMARY KEY,
  workshop_id       TEXT NOT NULL REFERENCES workshop (id),
  version_no        INTEGER NOT NULL CHECK (version_no >= 1),
  kind              TEXT NOT NULL CHECK (kind IN ('offer_1','offer_6')),
  schema_version    INTEGER NOT NULL CHECK (schema_version >= 1),
  content_json      TEXT NOT NULL CHECK (json_valid(content_json)),
  state             TEXT NOT NULL CHECK (state IN ('draft','finalised')),
  waiver_reason     TEXT CHECK (waiver_reason IS NULL OR length(waiver_reason) >= 10),
  correction_reason TEXT CHECK (correction_reason IS NULL OR length(correction_reason) >= 3),
  lock_no           INTEGER NOT NULL CHECK (lock_no >= 1),
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  finalised_by      TEXT,
  finalised_at      TEXT,
  classification    TEXT NOT NULL CHECK (classification = 'non_phi'),
  UNIQUE (workshop_id, version_no),
  CHECK (version_no = 1 OR correction_reason IS NOT NULL),
  CHECK ((state = 'finalised') = (finalised_by IS NOT NULL)),
  CHECK ((state = 'finalised') = (finalised_at IS NOT NULL))
);
CREATE UNIQUE INDEX workshop_finding_one_draft ON workshop_finding (workshop_id)
  WHERE state = 'draft';
CREATE TRIGGER workshop_finding_identity BEFORE UPDATE OF id, workshop_id, version_no, kind,
  created_by, created_at ON workshop_finding
BEGIN SELECT RAISE(ABORT, 'what a findings version is never changes'); END;
CREATE TRIGGER workshop_finding_finalised BEFORE UPDATE ON workshop_finding
WHEN OLD.state = 'finalised'
BEGIN SELECT RAISE(ABORT, 'a finalised findings version never changes; create a correction'); END;
CREATE TRIGGER workshop_finding_no_delete BEFORE DELETE ON workshop_finding
BEGIN SELECT RAISE(ABORT, 'a findings version cannot be deleted'); END;

CREATE TABLE workshop_output_document (
  id              TEXT PRIMARY KEY,
  workshop_id     TEXT NOT NULL REFERENCES workshop (id),
  finding_id      TEXT NOT NULL REFERENCES workshop_finding (id),
  revision_no     INTEGER NOT NULL CHECK (revision_no >= 1),
  sections_json   TEXT NOT NULL CHECK (json_valid(sections_json)),
  state           TEXT NOT NULL CHECK (state IN ('draft','approved')),
  edited_by       TEXT NOT NULL,
  edited_at       TEXT NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
  pdf_storage_key TEXT,
  pdf_sha256      TEXT,
  pdf_pages       INTEGER,
  file_deleted_at TEXT,
  UNIQUE (workshop_id, revision_no),
  CHECK (state <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL
    AND pdf_storage_key IS NOT NULL AND pdf_sha256 IS NOT NULL AND pdf_pages IS 1)),
  CHECK (state <> 'draft' OR (approved_by IS NULL AND approved_at IS NULL
    AND pdf_storage_key IS NULL AND pdf_sha256 IS NULL AND pdf_pages IS NULL))
);
CREATE TRIGGER workshop_output_revision_fixed BEFORE UPDATE OF id, workshop_id, finding_id,
  revision_no, sections_json, edited_by, edited_at ON workshop_output_document
BEGIN SELECT RAISE(ABORT, 'an output revision never changes; save a new revision'); END;
CREATE TRIGGER workshop_output_approve_once BEFORE UPDATE OF state, approved_by, approved_at,
  pdf_storage_key, pdf_sha256, pdf_pages ON workshop_output_document
WHEN NOT (OLD.state = 'draft' AND NEW.state = 'approved')
BEGIN SELECT RAISE(ABORT, 'an output is approved once and then fixed'); END;
CREATE TRIGGER workshop_output_deleted_once BEFORE UPDATE OF file_deleted_at
  ON workshop_output_document
WHEN OLD.state <> 'approved' OR OLD.file_deleted_at IS NOT NULL OR NEW.file_deleted_at IS NULL
BEGIN SELECT RAISE(ABORT, 'an approved output file is deleted once'); END;
CREATE TRIGGER workshop_output_no_delete BEFORE DELETE ON workshop_output_document
BEGIN SELECT RAISE(ABORT, 'an output record cannot be deleted'); END;

CREATE TABLE workshop_output_share (
  id        TEXT PRIMARY KEY,
  output_id TEXT NOT NULL REFERENCES workshop_output_document (id),
  how       TEXT NOT NULL CHECK (how IN ('handed_over','copied_link','other')),
  note      TEXT CHECK (note IS NULL OR length(note) <= 300),
  shared_by TEXT NOT NULL,
  shared_at TEXT NOT NULL
);
CREATE INDEX workshop_output_share_output ON workshop_output_share (output_id, shared_at);
CREATE TRIGGER workshop_output_share_approved BEFORE INSERT ON workshop_output_share
WHEN (SELECT state FROM workshop_output_document WHERE id = NEW.output_id) IS NOT 'approved'
BEGIN SELECT RAISE(ABORT, 'only an approved output can be shared'); END;
CREATE TRIGGER workshop_output_share_no_update BEFORE UPDATE ON workshop_output_share
BEGIN SELECT RAISE(ABORT, 'workshop_output_share is append-only'); END;
CREATE TRIGGER workshop_output_share_no_delete BEFORE DELETE ON workshop_output_share
BEGIN SELECT RAISE(ABORT, 'workshop_output_share is append-only'); END;
