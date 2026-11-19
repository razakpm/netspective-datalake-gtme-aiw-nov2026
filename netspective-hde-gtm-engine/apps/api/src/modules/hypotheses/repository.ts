import type { Tx } from "@gtm/db";

// Tx-bound reads for the hypotheses module (task T014).

export type HypothesisStatus =
  "untested" | "strengthening" | "weakening" | "validated" | "rejected" | "stale";

export interface HypothesisRow {
  id: string;
  account_id: string;
  origin: "analyst" | "ai";
  acceptance: "proposed" | "accepted" | "dismissed";
  statement: string;
  proposed_statement: string | null;
  category: string;
  status: HypothesisStatus | null;
  not_for_prioritisation: number;
  confidence_band: "low" | "medium" | "high";
  confidence_explanation: string;
  proposed_by_run_id: string | null;
  ai_model: string | null;
  ai_prompt_version_id: string | null;
  created_by: string | null;
  created_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  last_revived_at: string | null;
  flagged_for_review: number;
  flag_reason: string | null;
  updated_at: string;
}

export interface EvidenceRow {
  id: string;
  hypothesis_id: string;
  signal_id: string;
  role: "supporting" | "contradictory";
  linked_by: string | null;
  linked_by_type: "human" | "ai" | "system";
  linked_at: string;
}

export interface DecisionRow {
  id: string;
  hypothesis_id: string;
  from_status: string | null;
  to_status: HypothesisStatus;
  note: string;
  decided_by: string | null;
  decided_by_type: "human" | "system";
  reason_code: string | null;
  decided_at: string;
}

export const getHypothesis = (tx: Tx, id: string): HypothesisRow | undefined =>
  tx.prepare("SELECT * FROM account_hypothesis WHERE id = ?").get(id) as HypothesisRow | undefined;

export const listEvidence = (tx: Tx, hypothesisId: string): EvidenceRow[] =>
  tx
    .prepare("SELECT * FROM hypothesis_evidence WHERE hypothesis_id = ? ORDER BY linked_at, id")
    .all(hypothesisId) as unknown as EvidenceRow[];

export const listDecisions = (tx: Tx, hypothesisId: string): DecisionRow[] =>
  tx
    .prepare(
      "SELECT * FROM hypothesis_status_decision WHERE hypothesis_id = ? ORDER BY decided_at, id",
    )
    .all(hypothesisId) as unknown as DecisionRow[];
