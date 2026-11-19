import type { Tx } from "@gtm/db";

// Tx-bound reads for the research module (task T014). State changes happen only in the audited services.

export type RunState =
  | "queued"
  | "running"
  | "completed"
  | "budget_reached"
  | "needs_attention"
  | "failed"
  | "cancelled";

export interface RunRow {
  id: string;
  account_id: string;
  started_by: string;
  trigger: "manual" | "schedule";
  state: RunState;
  max_sources: number;
  max_cost_micros: number;
  reserved_micros: number;
  cost_micros: number;
  input_tokens: number;
  output_tokens: number;
  sources_read: number;
  dropped_uncited: number;
  dropped_unsupported: number;
  dropped_protected: number;
  dropped_taxonomy: number;
  injection_flags: number;
  retries: number;
  icp_excluded: number;
  stop_reason: string | null;
  requested_sources: string;
  summary_json: string | null;
  summary_prompt_version_id: string | null;
  attention_ack_by: string | null;
  attention_ack_at: string | null;
  attention_note: string | null;
  correlation_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface FetchRow {
  id: string;
  run_id: string;
  address: string;
  address_normalised: string;
  final_address: string | null;
  rule_id: string | null;
  outcome: string;
  http_status: number | null;
  content_sha256: string | null;
  size_bytes: number | null;
  truncated: number;
  injection_rule_ids: string;
  flagged: number;
  permitted_excerpt: string | null;
  fetched_at: string;
}

export interface FindingRow {
  id: string;
  run_id: string;
  fetch_id: string | null;
  kind: "fact" | "inference" | "unknown" | "contradiction";
  topic: string;
  statement: string;
  supporting_text: string | null;
  supporting_text_sha256: string | null;
  basis_finding_ids: string;
  second_fetch_id: string | null;
  type_key: string | null;
  extraction_confidence: "low" | "medium" | "high";
  verified: number;
  signal_id: string | null;
  signal_refusal_codes: string;
  carried_over_from_run: string | null;
  created_at: string;
}

export interface RuleRow {
  id: string;
  kind: string;
  match_type: "host" | "host_suffix";
  pattern: string;
  status: "enabled" | "disabled";
  signal_source_kind: string;
  created_by: string | null;
  created_at: string;
  status_label: string;
}

export const getRun = (tx: Tx, id: string): RunRow | undefined =>
  tx.prepare("SELECT * FROM research_run WHERE id = ?").get(id) as RunRow | undefined;

export const activeRunFor = (tx: Tx, accountId: string): RunRow | undefined =>
  tx
    .prepare("SELECT * FROM research_run WHERE account_id = ? AND state IN ('queued','running')")
    .get(accountId) as RunRow | undefined;

export const listFetches = (tx: Tx, runId: string): FetchRow[] =>
  tx
    .prepare("SELECT * FROM research_source_fetch WHERE run_id = ? ORDER BY fetched_at, id")
    .all(runId) as unknown as FetchRow[];

export const listFindings = (tx: Tx, runId: string): FindingRow[] =>
  tx
    .prepare("SELECT * FROM research_finding WHERE run_id = ? ORDER BY created_at, id")
    .all(runId) as unknown as FindingRow[];

export const listEnabledRules = (tx: Tx): RuleRow[] =>
  tx
    .prepare("SELECT * FROM research_source_rule WHERE status = 'enabled' ORDER BY pattern")
    .all() as unknown as RuleRow[];

/** The most recent processed fetch of this address for any run of this account (the cache key, R-10). */
export function latestProcessedFetch(
  tx: Tx,
  accountId: string,
  addressNormalised: string,
): FetchRow | undefined {
  return tx
    .prepare(
      `SELECT f.* FROM research_source_fetch f JOIN research_run r ON r.id = f.run_id
       WHERE r.account_id = ? AND f.address_normalised = ? AND f.outcome IN ('processed','too_large_truncated')
       ORDER BY f.fetched_at DESC, f.id DESC LIMIT 1`,
    )
    .get(accountId, addressNormalised) as FetchRow | undefined;
}

/** Cost recorded for an account in a calendar month (UTC): every model call about it, failed ones included. */
export function accountSpendMicros(tx: Tx, accountId: string, monthStartIso: string): number {
  const row = tx
    .prepare(
      "SELECT COALESCE(SUM(cost_micros), 0) AS c FROM ai_invocation WHERE account_id = ? AND occurred_at >= ?",
    )
    .get(accountId, monthStartIso) as { c: number };
  return row.c;
}

export interface AccountFacts {
  id: string;
  name: string;
  orgType: string;
  domains: string[];
  /** Excluded or on hold by feature 002's organisation-type rules, unless an exclusion override was granted. */
  excluded: boolean;
}

/** Account name, type, domains and exclusion status for the model input and the run banner (spec FR-016). */
export function accountFacts(tx: Tx, accountId: string): AccountFacts | undefined {
  const account = tx.prepare("SELECT id, name FROM account WHERE id = ?").get(accountId) as
    { id: string; name: string } | undefined;
  if (!account) return undefined;
  const cls = tx
    .prepare(
      "SELECT org_type FROM account_classification WHERE account_id = ? ORDER BY rowid DESC LIMIT 1",
    )
    .get(accountId) as { org_type: string } | undefined;
  const orgType = cls?.org_type ?? "unknown";
  const domains = (
    tx
      .prepare("SELECT domain FROM account_domain WHERE account_id = ? ORDER BY domain")
      .all(accountId) as {
      domain: string;
    }[]
  ).map((d) => d.domain);
  const override = tx
    .prepare(
      "SELECT action FROM exclusion_override WHERE account_id = ? ORDER BY rowid DESC LIMIT 1",
    )
    .get(accountId) as { action: string } | undefined;
  const excludedType = ["medtech", "payer", "multi_site_practice", "biotech"].includes(orgType);
  return {
    id: account.id,
    name: account.name,
    orgType,
    domains,
    excluded: excludedType && override?.action !== "grant",
  };
}
