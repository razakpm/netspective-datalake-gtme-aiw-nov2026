import { createHash } from "node:crypto";
import type { Tx } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";
import { aliasesOf, currentClassification, domainsOf, getAccount } from "./repository.js";

// Review queue for merge candidates (spec FR-004 to FR-006). A rejected pair is remembered through its
// pair key and an attribute fingerprint; it is proposed again only when a matching attribute changes.

export interface ReviewItemRow {
  id: string;
  kind: "merge_candidate" | "contact_conflict";
  subject_a: string;
  subject_b: string | null;
  reason_codes: string;
  score: number | null;
  pair_key: string;
  attribute_fingerprint: string;
  state: "open" | "merged" | "rejected" | "accepted";
  proposed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  proposed_values: string | null;
}

export const pairKey = (a: string, b: string) => [a, b].sort().join(":");

/** Hash of the attributes that matter for matching, for both accounts. */
export function pairFingerprint(tx: Tx, idA: string, idB: string): string {
  const snapshot = [idA, idB].sort().map((id) => {
    const account = getAccount(tx, id);
    return {
      name: account?.name ?? null,
      geography: account?.geography ?? null,
      type: currentClassification(tx, id).orgType,
      aliases: aliasesOf(tx, id).map((a) => a.alias),
      domains: domainsOf(tx, id).map((d) => d.domain),
    };
  });
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/** Create an open merge candidate unless one is open or the pair was rejected with unchanged attributes. */
export function proposeMerge(
  tx: Tx,
  input: { accountId: string; otherId: string; reasons: string[]; score: number },
  now: () => Date,
): boolean {
  const key = pairKey(input.accountId, input.otherId);
  const fingerprint = pairFingerprint(tx, input.accountId, input.otherId);
  const previous = tx
    .prepare(
      "SELECT state, attribute_fingerprint FROM review_item WHERE kind = 'merge_candidate' AND pair_key = ?",
    )
    .all(key) as { state: string; attribute_fingerprint: string }[];
  if (previous.some((p) => p.state === "open")) return false;
  if (previous.some((p) => p.state === "rejected" && p.attribute_fingerprint === fingerprint))
    return false;
  tx.prepare(
    `INSERT INTO review_item (id, kind, subject_a, subject_b, reason_codes, score, pair_key,
       attribute_fingerprint, state, proposed_at) VALUES (?,?,?,?,?,?,?,?,'open',?)`,
  ).run(
    uuidv7(),
    "merge_candidate",
    input.accountId,
    input.otherId,
    JSON.stringify(input.reasons),
    input.score,
    key,
    fingerprint,
    now().toISOString(),
  );
  return true;
}
