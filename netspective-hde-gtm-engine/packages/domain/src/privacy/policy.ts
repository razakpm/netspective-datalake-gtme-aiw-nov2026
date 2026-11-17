import type { GuardAction } from "./guard.js";

// Reject versus quarantine policy (clarification 2026-11-12, open question #23): the default for a
// flagged entry point is to reject. An entry point is quarantined only when it is explicitly
// configured for human review. Deterministic and versioned with the guard (constitution IX).

export const ENTRY_POINTS = [
  "api_body",
  "upload",
  "webhook",
  "provider_call",
  "llm_preflight",
  "log",
  "audit",
] as const;

export type EntryPoint = (typeof ENTRY_POINTS)[number];

export interface GuardPolicyConfig {
  /** Entry points (for example "upload", or "webhook:<source key>") configured for review. */
  quarantineEntryPoints: readonly string[];
}

export const DEFAULT_GUARD_POLICY: GuardPolicyConfig = { quarantineEntryPoints: [] };

/**
 * Entry points that can never be quarantined: content bound for a log, an audit row, a provider or
 * a model must be refused outright because holding it would not make sending it safe.
 */
const ALWAYS_REJECT: ReadonlySet<string> = new Set([
  "provider_call",
  "llm_preflight",
  "log",
  "audit",
]);

export function resolveGuardAction(
  entryPoint: string,
  config: GuardPolicyConfig = DEFAULT_GUARD_POLICY,
): GuardAction {
  if (ALWAYS_REJECT.has(entryPoint)) return "reject";
  return config.quarantineEntryPoints.includes(entryPoint) ? "quarantine" : "reject";
}
