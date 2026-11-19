import type { Tx } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";

// Tx-bound data access for the signals module (task T015). Writes that change state happen only in the
// audited service functions; this file holds the shared reads and the append helpers.

export interface SignalRow {
  id: string;
  account_id: string;
  contact_id: string | null;
  type_key: string;
  taxonomy_version: number;
  source_id: string;
  source_ref: string;
  source_ref_normalised: string;
  item_key: string | null;
  observation: string;
  excerpt: string | null;
  excerpt_withheld_reason: "none" | "too_long" | "source_no_storage";
  observed_at: string;
  collected_at: string;
  published_at: string | null;
  undated: number;
  reliability: "high" | "medium" | "low" | "unknown";
  reliability_overridden_by: string | null;
  extraction_method: "manual" | "provider" | "ai_extracted";
  extraction_confidence: "low" | "medium" | "high";
  ai_model: string | null;
  ai_prompt_version: string | null;
  evidence_status: string;
  review_status: "pending" | "approved" | "rejected" | "contradictory";
  new_provenance_flag: number;
  freshness_days: number;
  fresh_until: string;
  freshness_state: "fresh" | "stale";
  funding_class: "none" | "context" | "budget_approval_evidence";
  approval_citation: string | null;
  regulatory_item: string | null;
  regulatory_status: "proposed" | "unverified" | "reported_final" | null;
  context_only: number;
  reverify_required: number;
  retention_policy: string;
  retain_until: string;
  purged_at: string | null;
  sensitivity: string;
  content_fingerprint: string;
  created_by: string | null;
  created_by_type: "human" | "ai" | "system";
  created_at: string;
  updated_at: string;
}

export interface SourceRow {
  id: string;
  name: string;
  kind: string;
  default_reliability: "high" | "medium" | "low" | "unknown";
  storage_rule: "excerpt" | "citation_only";
  excerpt_max_chars: number | null;
  availability: "available" | "unavailable";
  unavailable_since: string | null;
  created_by: string | null;
  created_at: string;
  status_label: string;
}

export interface TypeRow {
  taxonomy_version: number;
  key: string;
  category: string;
  label: string;
  kind: "general" | "funding" | "regulatory" | "first_party";
  default_freshness_days: number;
  default_reliability: "high" | "medium" | "low" | "unknown";
  context_only: number;
  status: "active" | "retired";
  status_label: string;
}

export function getSignal(tx: Tx, id: string): SignalRow | undefined {
  return tx.prepare("SELECT * FROM signal WHERE id = ?").get(id) as SignalRow | undefined;
}

export function getSource(tx: Tx, id: string): SourceRow | undefined {
  return tx.prepare("SELECT * FROM signal_source WHERE id = ?").get(id) as SourceRow | undefined;
}

export function getSourceByName(tx: Tx, name: string): SourceRow | undefined {
  return tx.prepare("SELECT * FROM signal_source WHERE name = ?").get(name) as
    SourceRow | undefined;
}

export function currentTaxonomyVersion(tx: Tx): number {
  const row = tx.prepare("SELECT version FROM taxonomy_version WHERE status = 'current'").get() as
    { version: number } | undefined;
  if (!row) throw new Error("no current signal taxonomy version (run the reference seed)");
  return row.version;
}

export function getType(tx: Tx, version: number, key: string): TypeRow | undefined {
  return tx
    .prepare("SELECT * FROM signal_type WHERE taxonomy_version = ? AND key = ?")
    .get(version, key) as TypeRow | undefined;
}

export interface ProvenanceInput {
  kind: string;
  actorId: string | null;
  actorType: "human" | "ai" | "system";
  method?: string | null;
  sourceId?: string | null;
  sourceRef?: string | null;
  detail?: Record<string, unknown>;
  at: string;
}

/** Append one step to a signal's provenance chain. The detail holds codes and ids only. */
export function appendProvenance(tx: Tx, signalId: string, p: ProvenanceInput): number {
  const last = tx
    .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM signal_provenance WHERE signal_id = ?")
    .get(signalId) as { seq: number };
  const seq = last.seq + 1;
  tx.prepare(
    `INSERT INTO signal_provenance (id, signal_id, seq, kind, actor_id, actor_type, method, source_id,
       source_ref, detail, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    uuidv7(),
    signalId,
    seq,
    p.kind,
    p.actorId,
    p.actorType,
    p.method ?? null,
    p.sourceId ?? null,
    p.sourceRef ?? null,
    JSON.stringify(p.detail ?? {}),
    p.at,
  );
  return seq;
}

export interface AccountScope {
  /** The surviving account (follows `merged_into`). */
  survivor: string;
  /** The survivor plus every account merged into it, directly or through a chain. */
  ids: string[];
}

/** Resolve an account to its survivor and the accounts merged into it. Signals keep their original account id. */
export function resolveAccountScope(tx: Tx, accountId: string): AccountScope | undefined {
  let current = accountId;
  const seen = new Set<string>();
  for (;;) {
    const row = tx.prepare("SELECT id, merged_into FROM account WHERE id = ?").get(current) as
      { id: string; merged_into: string | null } | undefined;
    if (!row) return undefined;
    if (!row.merged_into || seen.has(row.id)) break;
    seen.add(row.id);
    current = row.merged_into;
  }
  const ids = [current];
  for (let i = 0; i < ids.length; i++) {
    const children = tx.prepare("SELECT id FROM account WHERE merged_into = ?").all(ids[i]!) as {
      id: string;
    }[];
    for (const c of children) if (!ids.includes(c.id)) ids.push(c.id);
  }
  return { survivor: current, ids };
}
