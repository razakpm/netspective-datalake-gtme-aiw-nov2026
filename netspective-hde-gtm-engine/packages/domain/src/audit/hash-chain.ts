import { createHash } from "node:crypto";

// Tamper-evident audit chain (research R-11, task T057). Each row's hash covers a canonical form of its
// fields plus the previous row's hash, so editing, removing or reordering rows is detectable. This is
// detection, not prevention: someone who rewrites every later row can only be caught by comparing the
// chain head with a copy kept elsewhere.

export interface HashableAuditRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  outcome: string;
  before_summary: string | null;
  after_summary: string | null;
  correlation_id: string | null;
}

export interface ChainRow extends HashableAuditRow {
  prev_hash: string | null;
  row_hash: string;
}

/** Fixed field order, JSON-encoded as an array so field boundaries cannot be confused. */
export function canonicalizeAuditRow(row: HashableAuditRow, prevHash: string | null): string {
  return JSON.stringify([
    row.id,
    row.occurred_at,
    row.actor_id,
    row.actor_type,
    row.action,
    row.entity_type,
    row.entity_id,
    row.outcome,
    row.before_summary,
    row.after_summary,
    row.correlation_id,
    prevHash,
  ]);
}

export function computeRowHash(row: HashableAuditRow, prevHash: string | null): string {
  return createHash("sha256").update(canonicalizeAuditRow(row, prevHash)).digest("hex");
}

export type ChainVerification =
  | { ok: true; count: number }
  | { ok: false; rowId: string; reason: "hash_mismatch" | "broken_link" };

/**
 * Verify rows given in write order. `anchorPrevHash` is the expected `prev_hash` of the first row: null
 * for a full chain, or the last removed hash after a retention drop.
 */
export function verifyChain(
  rows: readonly ChainRow[],
  options: { anchorPrevHash?: string | null } = {},
): ChainVerification {
  let expectedPrev: string | null = options.anchorPrevHash ?? null;
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) return { ok: false, rowId: row.id, reason: "broken_link" };
    if (computeRowHash(row, row.prev_hash) !== row.row_hash) {
      return { ok: false, rowId: row.id, reason: "hash_mismatch" };
    }
    expectedPrev = row.row_hash;
  }
  return { ok: true, count: rows.length };
}
