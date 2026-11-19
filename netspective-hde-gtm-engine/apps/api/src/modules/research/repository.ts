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
       WHERE r.account_id = ? AND f.address_normalised = ? AND f.outcome = 'processed'
       ORDER BY f.fetched_at DESC, f.id DESC LIMIT 1`,
    )
    .get(accountId, addressNormalised) as FetchRow | undefined;
}

/** Cost recorded for an account in a calendar month (UTC), for runs and other contexts alike. */
export function accountSpendMicros(tx: Tx, accountId: string, monthStartIso: string): number {
  const runs = tx
    .prepare(
      `SELECT COALESCE(SUM(i.cost_micros), 0) AS c FROM ai_invocation i
       JOIN research_run r ON i.context_type = 'research_run' AND i.context_id = r.id
       WHERE r.account_id = ? AND i.occurred_at >= ?`,
    )
    .get(accountId, monthStartIso) as { c: number };
  const interpretations = tx
    .prepare(
      `SELECT COALESCE(SUM(cost_micros), 0) AS c FROM problem_interpretation
       WHERE account_id = ? AND created_at >= ?`,
    )
    .get(accountId, monthStartIso) as { c: number };
  return runs.c + interpretations.c;
}
