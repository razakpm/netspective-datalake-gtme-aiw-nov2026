import type { Tx } from "@gtm/db";
import type { FitEvidence } from "@gtm/domain";

// Persistence for ICP assessments (feature 002 slice, built in feature 006). SQL only.

export interface ActiveDefinition {
  id: string;
  icp: "icp1" | "icp2";
  version: number;
  rules: string;
}

export function activeDefinitions(tx: Tx): ActiveDefinition[] {
  return tx
    .prepare(
      "SELECT id, icp, version, rules FROM icp_definition WHERE state = 'active' ORDER BY icp",
    )
    .all() as unknown as ActiveDefinition[];
}

export function evidenceFor(tx: Tx, accountId: string): FitEvidence[] {
  return tx
    .prepare("SELECT topic, status FROM evidence_reference WHERE account_id = ? ORDER BY rowid")
    .all(accountId) as unknown as FitEvidence[];
}

export function insertAssessment(
  tx: Tx,
  a: {
    id: string;
    accountId: string;
    icp: string;
    definitionId: string;
    definitionVersion: number;
    status: string;
    confidence: string;
    basis: string[];
    met: string[];
    unmet: string[];
    missing: string[];
    contradictory: string[];
    inputsHash: string;
    assessedBy: string | null;
    assessedAt: string;
  },
): void {
  tx.prepare(
    `INSERT INTO icp_fit_assessment (id, account_id, icp, definition_id, definition_version, status, confidence,
       basis, met, unmet, missing, contradictory, inputs_hash, assessed_by, assessed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    a.id,
    a.accountId,
    a.icp,
    a.definitionId,
    a.definitionVersion,
    a.status,
    a.confidence,
    JSON.stringify(a.basis),
    JSON.stringify(a.met),
    JSON.stringify(a.unmet),
    JSON.stringify(a.missing),
    JSON.stringify(a.contradictory),
    a.inputsHash,
    a.assessedBy,
    a.assessedAt,
  );
}

export function latestAssessments(
  tx: Tx,
  accountId: string,
): { id: string; icp: "icp1" | "icp2"; status: string; inputsHash: string; assessedAt: string }[] {
  return (
    tx
      .prepare(
        `SELECT id, icp, status, inputs_hash, assessed_at FROM icp_fit_assessment a
         WHERE account_id = ? AND rowid = (SELECT max(rowid) FROM icp_fit_assessment b WHERE b.account_id = a.account_id AND b.icp = a.icp)
         ORDER BY icp`,
      )
      .all(accountId) as {
      id: string;
      icp: "icp1" | "icp2";
      status: string;
      inputs_hash: string;
      assessed_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    icp: r.icp,
    status: r.status,
    inputsHash: r.inputs_hash,
    assessedAt: r.assessed_at,
  }));
}
