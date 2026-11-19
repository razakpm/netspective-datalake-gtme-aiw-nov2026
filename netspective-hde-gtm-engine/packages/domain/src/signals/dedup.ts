import { textSimilarity } from "./similarity.js";

// De-duplication decision (spec FR-020 to FR-024; research R-04). Pure and deterministic, in this order:
//   identical -> republication -> duplicate -> new.
// A fingerprint already seen from the same source is `identical` even when it arrived as a merge, so
// resubmitting any earlier input changes nothing (idempotence).

export interface SeenEntry {
  fingerprint: string;
  sourceId: string;
}

export interface DedupCandidate {
  id: string;
  accountId: string;
  typeKey: string;
  sourceId: string;
  itemKey: string | null;
  observationNormalised: string;
  /** The first recording plus every merged entry. */
  seen: readonly SeenEntry[];
}

export interface DedupInput {
  accountId: string;
  typeKey: string;
  sourceId: string;
  itemKey: string | null;
  fingerprint: string;
  observation: string;
}

export type DedupDecision =
  | { kind: "new" }
  | { kind: "identical"; signalId: string }
  | { kind: "merge"; signalId: string; reason: "republication" | "duplicate"; similarity?: number };

export function decideDuplicate(
  input: DedupInput,
  candidates: readonly DedupCandidate[],
  threshold: number,
): DedupDecision {
  const pool = candidates
    .filter((c) => c.accountId === input.accountId && c.typeKey === input.typeKey)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const c of pool) {
    if (c.seen.some((s) => s.fingerprint === input.fingerprint && s.sourceId === input.sourceId)) {
      return { kind: "identical", signalId: c.id };
    }
  }
  for (const c of pool) {
    const sameContent = c.seen.some((s) => s.fingerprint === input.fingerprint);
    const sameItem = input.itemKey !== null && c.itemKey === input.itemKey;
    if (sameContent || sameItem) {
      return { kind: "merge", signalId: c.id, reason: "republication" };
    }
  }
  let best: { id: string; score: number } | null = null;
  for (const c of pool) {
    if (c.sourceId !== input.sourceId) continue;
    const score = textSimilarity(input.observation, c.observationNormalised);
    if (score >= threshold && (best === null || score > best.score)) best = { id: c.id, score };
  }
  if (best)
    return { kind: "merge", signalId: best.id, reason: "duplicate", similarity: best.score };
  return { kind: "new" };
}

/** Independent sources for corroboration: distinct signals, never merged entries (FR-023). */
export function independentSourceCount(signalIds: readonly string[]): number {
  return new Set(signalIds).size;
}
