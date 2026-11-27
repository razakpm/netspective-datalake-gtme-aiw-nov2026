import type { Tx } from "@gtm/db";

// Read-only view of an account's recorded evidence for other modules (feature 007, research R-08). The
// caller checks permissions. The text is the record's own wording.

export interface EvidenceRecord {
  id: string;
  topic: string;
  status:
    | "observed"
    | "buyer_confirmed"
    | "derived_interpretation"
    | "ai_hypothesis"
    | "unverified_assumption"
    | "contradictory";
  text: string;
}

export function evidenceFor(tx: Tx, accountId: string): EvidenceRecord[] {
  return tx
    .prepare(
      "SELECT id, topic, status, what AS text FROM evidence_reference WHERE account_id = ? ORDER BY rowid",
    )
    .all(accountId)
    .map((row) => ({ ...row })) as unknown as EvidenceRecord[];
}
