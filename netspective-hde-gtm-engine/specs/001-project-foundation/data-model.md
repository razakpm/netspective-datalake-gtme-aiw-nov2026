# Data Model: Project Foundation

Conventions: UUIDv7 primary keys (`id`); `created_at` and `updated_at` (timestamptz) on every mutable table; append-only tables have `created_at` only. Every column declares a data classification (spec FR-015); the classification is shown in the "Class" column using the abbreviations **pub** (public), **bc** (business_contact), **cc** (confidential_commercial), **som** (sensitive_operational_metadata). No column may hold `prohibited` content. Migrations are forward-only.

Actor types used throughout: `human`, `ai`, `system`.

## Identity

### user
| Column | Type | Class | Notes |
|---|---|---|---|
| id | uuid | som | PK |
| email | citext | bc | unique, lower-cased, company domain |
| display_name | text | bc | |
| status | enum | som | `invited`, `active`, `deactivated` |
| idp_subject | text | som | OIDC `sub`, set at first sign-in, unique when present |
| invited_by | uuid | som | FK user.id; null only for bootstrap |
| last_sign_in_at | timestamptz | som | |

State transitions: `invited → active` (first successful sign-in), `active → deactivated`, `deactivated → active` (re-activation by administrator), `invited → deactivated` (revoke). Every transition writes an audit event. Rule: the transition that would leave zero active administrators is rejected (FR-007), enforced in-transaction with a lock on the administrator role membership.

### invitation
| Column | Type | Class | Notes |
|---|---|---|---|
| id | uuid | som | PK |
| user_id | uuid | som | FK user.id |
| expires_at | timestamptz | som | default created + 7 days |
| status | enum | som | `pending`, `accepted`, `expired`, `revoked` |
| invited_by | uuid | som | FK user.id |

### role
Seeded, one row per role: `gtm_operator`, `research_analyst`, `technical_sme_reviewer`, `sales_service_lead`, `campaign_approver`, `administrator`, `read_only_executive`. Columns: `id`, `key` (unique), `name`, `description`. Role rows are not user-editable in this feature.

### permission
`id`, `key` (unique, for example `users.manage`), `description`. Seeded foundation permissions: `users.manage`, `audit.read`, `jobs.read`, `webhooks.read`, `quarantine.review`, `ai_invocations.read`, `providers.manage`.

### role_permission
`role_id`, `permission_key`; composite PK. The seed grants all foundation permissions to `administrator`; `jobs.read` and `webhooks.read` to `gtm_operator`; `audit.read`, `jobs.read` and `ai_invocations.read` to `read_only_executive`; and none to the other roles. This matrix is a hypothesis pending the GTM lead (open question #27); later features add their own permissions.

### user_role
`user_id`, `role_id`, `assigned_by`, `assigned_at`; composite PK. A user may hold zero or more roles (FR-008). Effective permissions are the union of role permissions, computed per request from this table (never from token claims).

Validation: an actor with type `ai` or `system` cannot be assigned `administrator` or any role that carries `users.manage` or approval permissions (FR-009). Enforced in the domain rule `canAssignRole(actorType, role)`, which every role-assignment path calls, and structurally: the `user` table holds human users only. AI and system actors are not users, have no `user_role` rows, and appear only as `actor_type` on audit and outbox rows.

## Audit and events

### audit_event (append-only, monthly partitions)
| Column | Type | Class | Notes |
|---|---|---|---|
| id | uuid | som | PK |
| occurred_at | timestamptz | som | partition key |
| actor_id | uuid | som | nullable for system |
| actor_type | enum | som | human, ai, system |
| action | text | som | for example `user.role.assigned`, `user.manage.denied`, `phi.blocked` |
| entity_type | text | som | |
| entity_id | text | som | |
| outcome | enum | som | `success`, `denied`, `failed` |
| before_summary | jsonb | som | redacted, size-limited, passed through PHI guard |
| after_summary | jsonb | som | same |
| correlation_id | text | som | |
| prev_hash | bytea | som | hash chain |
| row_hash | bytea | som | |

Constraints: migration 0001 creates a default partition plus partitions for the current and next 12 months so inserts never fail; ongoing partition creation is added by the hardening migration; the application database role has INSERT and SELECT only; a trigger raises on UPDATE and DELETE; retention removes whole partitions via a separately audited privileged command. Indexes: `(entity_type, entity_id, occurred_at)`, `(actor_id, occurred_at)`, `(correlation_id)`. An audit row is written in the same transaction as the change it records; a failed audit write aborts the change (FR-013). Denials and PHI blocks are written with `outcome = denied` or `failed` and never include blocked content (FR-011, FR-014, FR-019).

### outbox_event
| Column | Type | Class | Notes |
|---|---|---|---|
| id | uuid | som | event_id |
| type | text | som | |
| schema_version | int | som | |
| occurred_at | timestamptz | som | |
| actor_id, actor_type | uuid, enum | som | |
| correlation_id | text | som | |
| causation_id | text | som | |
| idempotency_key | text | som | |
| payload | jsonb | som | guarded |
| provenance | jsonb | som | |
| dispatched_at | timestamptz | som | null until delivered |

State: `pending → dispatched`. The dispatcher marks dispatch idempotently using `FOR UPDATE SKIP LOCKED`.

## Jobs

### job
| Column | Type | Class | Notes |
|---|---|---|---|
| id | uuid | som | PK |
| queue | text | som | |
| idempotency_key | text | som | unique with `queue` |
| payload | jsonb | som | guarded; no prohibited content |
| state | enum | som | `queued`, `running`, `succeeded`, `failed` |
| attempts | int | som | |
| max_attempts | int | som | from retry policy |
| next_run_at | timestamptz | som | |
| scheduled_by | text | som | schedule name or actor |
| last_error | jsonb | som | redacted: code, message, stack hash; no payload echo |
| correlation_id | text | som | |

State transitions: `queued → running → succeeded`; `running → queued` (retry with backoff while `attempts < max_attempts`); `running → failed` (attempts exhausted). `failed` and `succeeded` are terminal. A duplicate submission with the same `(queue, idempotency_key)` returns the existing row. Every transition writes an audit event (FR-026). Queue depth beyond the cap rejects new submissions with a typed back-pressure error (FR-027).

## Webhooks

### webhook_source
`id`, `key` (unique), `verification_mode` enum (`hmac_sha256`, `not_verifiable`), `secret_ref` (name of a configured secret, never the value), `previous_secret_ref` (rotation overlap), `skew_seconds`, `max_body_bytes`, `phi_policy` enum (`reject`, `quarantine`), `enabled`. `not_verifiable` sources are flagged in the administrator view and their deliveries are never processed unless `process_unverified = true` is explicitly set by an administrator (audited).

### webhook_event
| Column | Type | Class | Notes |
|---|---|---|---|
| id | uuid | som | PK |
| source_id | uuid | som | FK webhook_source |
| delivery_id | text | som | unique with `source_id` |
| received_at | timestamptz | som | |
| attempt_count | int | som | incremented on replays |
| verification_status | enum | som | `verified`, `failed`, `not_verifiable` |
| status | enum | som | `received`, `processing`, `processed`, `duplicate`, `rejected_stale`, `rejected_oversize`, `blocked_phi`, `failed` |
| raw_headers | jsonb | cc | null when `blocked_phi` |
| raw_body | bytea | cc | null when `blocked_phi` or oversize |
| body_sha256 | bytea | som | kept even when body not stored |
| correlation_id | text | som | |

State: `received → processing → processed | failed`; `received → blocked_phi`, `rejected_stale`, `rejected_oversize` (terminal, no processing); repeat deliveries set `attempt_count` and, if first attempt was already processed, record `duplicate` on the attempt without reprocessing. Processing is enqueued as a job keyed by `(source, delivery_id)`.

### phi_guard_decision
Result of each guard evaluation that was not a plain allow (allows are counted in metrics only). Columns: `id`, `occurred_at`, `entry_point` (`api_body`, `upload`, `webhook`, `provider_call`, `llm_preflight`, `log`, `audit`), `decision` (`reject`, `quarantine`), `rule_ids` (text[]), `guard_version`, `correlation_id`, `entity_ref`. **Never stores the content** (FR-019). Class: som.

### quarantine_item
`id`, `entry_point`, `reason_rule_ids` (text[]), `content_encrypted` (bytea, application-layer encryption), `content_sha256`, `status` (`held`, `released`, `discarded`), `held_until` (default created + 30 days), `decided_by`, `decided_at`, `decision_reason`. Access log in `quarantine_access` (`item_id`, `actor_id`, `accessed_at`, `purpose`) and every access also writes an audit event (FR-020). Class: cc; content is the only column that may temporarily hold suspected-prohibited material, which is why it is encrypted, time-limited and restricted to `quarantine.review`.

## Providers and AI

### provider_connection
| Column | Type | Class | Notes |
|---|---|---|---|
| id | uuid | som | PK |
| interface | enum | som | the 8 provider interfaces |
| implementation | text | som | e.g. `fake`, `local_disk`, `s3`, `smtp_sink` |
| is_fake | boolean | som | true for all test/dev implementations |
| config_ref | text | som | name of configured secret/config; **no credentials stored** |
| status | enum | som | `enabled`, `disabled` |
| last_health_at, last_health_status | timestamptz, text | som | |

Constraint: at most one `enabled` connection per interface per environment; the production environment refuses `is_fake = true` (checked at start-up).

### prompt_version
`id`, `name`, `version` (semver), `template_hash`, `output_schema_id`, `output_schema_version`, `status` (`draft`, `approved`, `retired`), `approved_by`, `approved_at`. Unique `(name, version)`. The prompt text lives in versioned files in `packages/ai-contracts`; the table stores identity and hash only. Retired versions cannot be invoked.

### ai_invocation
| Column | Type | Class | Notes |
|---|---|---|---|
| id | uuid | som | PK |
| occurred_at | timestamptz | som | |
| provider_connection_id | uuid | som | |
| model | text | som | |
| prompt_version_id | uuid | som | FK |
| schema_version | text | som | |
| input_tokens, output_tokens | int | som | |
| cost_estimate_usd | numeric | som | estimate from configured rates |
| latency_ms | int | som | |
| validation_result | enum | som | `valid`, `invalid`, `not_run` |
| outcome | enum | som | `completed`, `refused_phi`, `provider_error`, `invalid_output` |
| refusal_rule_ids | text[] | som | rule IDs only |
| correlation_id | text | som | |
| actor_id / actor_type | uuid / enum | som | |

The row stores no prompt body, response body or reasoning trace (FR-041). Retention: 12 months (open question #17 default). Output with `validation_result = invalid` is never returned to a caller as a result (FR-042).

## API idempotency

### idempotency_record
| Column | Type | Class | Notes |
|---|---|---|---|
| id | uuid | som | PK |
| actor_id | uuid | som | caller; keys are scoped per caller |
| route | text | som | operation, for example `POST /users` |
| idempotency_key | text | som | caller-supplied, 8–128 characters; unique with `(actor_id, route)` |
| request_hash | bytea | som | SHA-256 of the canonical request body |
| response_status | int | som | |
| response_body | jsonb | bc | stored result; passed through the PHI guard before storage |
| created_at | timestamptz | som | |
| expires_at | timestamptz | som | default created + 24 hours (FR-053, hypothesis) |

Behaviour (FR-055): the same key with the same `request_hash` returns the stored response without a second effect; the same key with a different `request_hash` is rejected with 422; an expired record is removed by the scheduled purge and the key can then be reused. The record is written in the same transaction as the change it protects.

## Entities from the spec without their own table
- **Role**, **Permission**, **User**, **Audit Event**, **Job**, **Webhook Delivery** (`webhook_event`), **Data Classification** (domain enum plus the Class column above), **PHI Detection Result** (`phi_guard_decision`), **Quarantine Item**, **Provider Connection**, **AI Invocation Record** (`ai_invocation`), **Prompt Version** all map as described above.

## Relationships
```text
user 1─* user_role *─1 role 1─* role_permission *─1 permission
user 1─* invitation
webhook_source 1─* webhook_event
webhook_event ─ enqueues ─> job (key: source + delivery_id)
provider_connection 1─* ai_invocation *─1 prompt_version
audit_event ─ references (by type/id) ─> any entity
outbox_event ─ written in same transaction as ─> audit_event
```

## Retention (defaults; confirm with privacy lead, open question #17)
| Data | Retention | Mechanism |
|---|---|---|
| audit_event | 7 years | drop monthly partitions via audited maintenance command |
| ai_invocation | 12 months | scheduled purge job |
| webhook_event raw body/headers | 90 days then body nulled, metadata kept **[Assumption]** | scheduled purge job |
| quarantine_item | 30 days max holding, then content purged | scheduled purge job |
| job last_error and payload | 90 days after terminal state **[Assumption]** | scheduled purge job |
| idempotency_record | 24 hours **[Assumption]** | scheduled purge job |
| user | until deactivated and deletion requested; audit rows keep the id only | administrator action |
