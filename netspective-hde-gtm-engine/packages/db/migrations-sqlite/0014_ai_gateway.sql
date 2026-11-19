-- Interim SQLite migration (ADR-015), feature 004. Prompt registry and AI invocation ledger: the minimal
-- slice of feature 001's US8 that the research agents need. No prompt body, response body or reasoning
-- trace column exists.
CREATE TABLE prompt_version (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  version                TEXT NOT NULL,
  template_hash          TEXT NOT NULL,
  output_schema_id       TEXT NOT NULL,
  output_schema_version  TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('draft','approved','retired')),
  approved_by            TEXT,
  approved_at            TEXT,
  UNIQUE (name, version)
);

CREATE TABLE ai_invocation (
  id                 TEXT PRIMARY KEY,
  occurred_at        TEXT NOT NULL,
  provider           TEXT NOT NULL CHECK (provider IN ('fake','anthropic')),
  model              TEXT NOT NULL,
  task               TEXT NOT NULL CHECK (task IN ('extraction','synthesis','interpretation')),
  prompt_version_id  TEXT NOT NULL REFERENCES prompt_version (id),
  schema_version     TEXT NOT NULL,
  context_type       TEXT NOT NULL CHECK (context_type IN ('research_run','problem_interpretation','other')),
  context_id         TEXT,
  attempt            INTEGER NOT NULL CHECK (attempt >= 1),
  input_tokens       INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens      INTEGER NOT NULL CHECK (output_tokens >= 0),
  cost_micros        INTEGER NOT NULL CHECK (cost_micros >= 0),
  latency_ms         INTEGER NOT NULL CHECK (latency_ms >= 0),
  validation_result  TEXT NOT NULL CHECK (validation_result IN ('valid','invalid','not_run')),
  outcome            TEXT NOT NULL CHECK (outcome IN ('completed','refused_phi','provider_error','invalid_output','budget_refused')),
  refusal_rule_ids   TEXT NOT NULL DEFAULT '[]',
  correlation_id     TEXT,
  actor_id           TEXT,
  actor_type         TEXT NOT NULL CHECK (actor_type IN ('human','ai','system'))
);
CREATE INDEX ai_invocation_context ON ai_invocation (context_type, context_id);
CREATE INDEX ai_invocation_time ON ai_invocation (occurred_at);

CREATE TRIGGER ai_invocation_no_update BEFORE UPDATE ON ai_invocation
BEGIN SELECT RAISE(ABORT, 'ai_invocation is append-only'); END;
CREATE TRIGGER ai_invocation_no_delete BEFORE DELETE ON ai_invocation
BEGIN SELECT RAISE(ABORT, 'ai_invocation is append-only'); END;
