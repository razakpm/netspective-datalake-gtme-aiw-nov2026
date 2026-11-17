import type { ActorType } from "../actors.js";
import { guardValue } from "../privacy/guard.js";

// Audit event shape and summary sanitising (spec FR-010, FR-013, FR-014). Summaries describe a change
// in a few fields; they never carry content. Secret-looking keys are redacted, and a summary the PHI
// guard rejects is withheld whole (the marker names rule IDs only).

export const AUDIT_OUTCOMES = ["success", "denied", "failed"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export interface AuditEventInput {
  actorId: string | null;
  actorType: ActorType;
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome: AuditOutcome;
  before?: unknown;
  after?: unknown;
  correlationId?: string | null;
}

export const REDACTED = "[REDACTED]";
const SECRET_KEY = /secret|password|passwd|token|authorization|api[-_]?key|cookie|credential/i;

export function redactSecretKeys(value: unknown, depth = 0): unknown {
  if (depth > 10) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactSecretKeys(v, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? REDACTED : redactSecretKeys(v, depth + 1),
      ]),
    );
  }
  return value;
}

/** Returns the JSON text to store, or null when there is no summary. */
export function summarize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const redacted = redactSecretKeys(value);
  const decision = guardValue(redacted);
  if (decision.decision !== "allow") {
    return JSON.stringify({ withheld: true, rule_ids: decision.rule_ids });
  }
  return JSON.stringify(redacted);
}
