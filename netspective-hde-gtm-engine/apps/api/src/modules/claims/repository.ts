import type { Tx } from "@gtm/db";
import type { ClaimClass, ClaimStatus, PhraseRule } from "@gtm/domain";

// Persistence for claims, evidence, reviews, false-positive dispositions and phrase list versions
// (feature 005). SQL only: rules live in packages/domain and in the service.

export interface ClaimRecord {
  id: string;
  text: string;
  declaredClass: ClaimClass | null;
  effectiveClass: ClaimClass;
  status: ClaimStatus;
  draftedBy: string;
  draftedAt: string;
  versionNo: number;
}
export interface EvidenceRecord {
  id: string;
  claimId: string;
  kind: string;
  reference: string;
  owner: string;
  addedBy: string;
  addedAt: string;
  expiresAt: string;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
}
export interface ReviewRecord {
  id: string;
  claimId: string;
  decision: "approve" | "reject";
  reviewerId: string;
  note: string;
  decidedAt: string;
}
export interface DispositionRecord {
  id: string;
  sentenceHash: string;
  ruleId: string;
  reason: string;
  reviewerId: string;
  decidedAt: string;
}
export interface PhraseListRecord {
  version: number;
  rules: PhraseRule[];
  owner: string;
  reviewedBy: string;
  reviewedAt: string;
  createdBy: string;
  createdAt: string;
  note: string | null;
}

type Row = Record<string, unknown>;
const claim = (r: Row): ClaimRecord => ({
  id: r["id"] as string,
  text: r["text"] as string,
  declaredClass: r["declared_class"] as ClaimClass | null,
  effectiveClass: r["effective_class"] as ClaimClass,
  status: r["status"] as ClaimStatus,
  draftedBy: r["drafted_by"] as string,
  draftedAt: r["drafted_at"] as string,
  versionNo: r["version_no"] as number,
});
const evidence = (r: Row): EvidenceRecord => ({
  id: r["id"] as string,
  claimId: r["claim_id"] as string,
  kind: r["kind"] as string,
  reference: r["reference"] as string,
  owner: r["owner"] as string,
  addedBy: r["added_by"] as string,
  addedAt: r["added_at"] as string,
  expiresAt: r["expires_at"] as string,
  withdrawnAt: r["withdrawn_at"] as string | null,
  withdrawnBy: r["withdrawn_by"] as string | null,
});

export function insertClaim(tx: Tx, c: Omit<ClaimRecord, "versionNo">): void {
  tx.prepare(
    "INSERT INTO claim (id, text, declared_class, effective_class, status, drafted_by, drafted_at, version_no) VALUES (?,?,?,?,?,?,?,1)",
  ).run(c.id, c.text, c.declaredClass, c.effectiveClass, c.status, c.draftedBy, c.draftedAt);
}

export function getClaim(tx: Tx, id: string): ClaimRecord | null {
  const row = tx.prepare("SELECT * FROM claim WHERE id = ?").get(id) as Row | undefined;
  return row ? claim(row) : null;
}

export function listClaims(
  tx: Tx,
  filter: { status?: ClaimStatus | undefined } = {},
): ClaimRecord[] {
  const rows = (
    filter.status
      ? tx
          .prepare("SELECT * FROM claim WHERE status = ? ORDER BY drafted_at DESC, rowid DESC")
          .all(filter.status)
      : tx.prepare("SELECT * FROM claim ORDER BY drafted_at DESC, rowid DESC").all()
  ) as Row[];
  return rows.map(claim);
}

/** Optimistic text change; returns false when the version moved on. */
export function updateClaimText(
  tx: Tx,
  id: string,
  expectedVersion: number,
  patch: { text: string; declaredClass: ClaimClass | null; effectiveClass: ClaimClass },
): boolean {
  const res = tx
    .prepare(
      "UPDATE claim SET text = ?, declared_class = ?, effective_class = ?, version_no = version_no + 1 WHERE id = ? AND version_no = ?",
    )
    .run(patch.text, patch.declaredClass, patch.effectiveClass, id, expectedVersion);
  return Number(res.changes) === 1;
}

export function setClaimStatus(tx: Tx, id: string, status: ClaimStatus): void {
  tx.prepare("UPDATE claim SET status = ?, version_no = version_no + 1 WHERE id = ?").run(
    status,
    id,
  );
}

export function insertEvidence(
  tx: Tx,
  e: Omit<EvidenceRecord, "withdrawnAt" | "withdrawnBy">,
): void {
  tx.prepare(
    "INSERT INTO claim_evidence (id, claim_id, kind, reference, owner, added_by, added_at, expires_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(e.id, e.claimId, e.kind, e.reference, e.owner, e.addedBy, e.addedAt, e.expiresAt);
}

export function listEvidence(tx: Tx, claimId: string): EvidenceRecord[] {
  return (
    tx
      .prepare("SELECT * FROM claim_evidence WHERE claim_id = ? ORDER BY added_at, rowid")
      .all(claimId) as Row[]
  ).map(evidence);
}

export function getEvidence(tx: Tx, id: string): EvidenceRecord | null {
  const row = tx.prepare("SELECT * FROM claim_evidence WHERE id = ?").get(id) as Row | undefined;
  return row ? evidence(row) : null;
}

export function withdrawEvidence(tx: Tx, id: string, by: string, at: string): void {
  tx.prepare("UPDATE claim_evidence SET withdrawn_at = ?, withdrawn_by = ? WHERE id = ?").run(
    at,
    by,
    id,
  );
}

export function insertReview(tx: Tx, r: ReviewRecord): void {
  tx.prepare(
    "INSERT INTO claim_review (id, claim_id, decision, reviewer_id, note, decided_at) VALUES (?,?,?,?,?,?)",
  ).run(r.id, r.claimId, r.decision, r.reviewerId, r.note, r.decidedAt);
}

export function listReviews(tx: Tx, claimId: string): ReviewRecord[] {
  return (
    tx
      .prepare("SELECT * FROM claim_review WHERE claim_id = ? ORDER BY decided_at, rowid")
      .all(claimId) as Row[]
  ).map((r) => ({
    id: r["id"] as string,
    claimId: r["claim_id"] as string,
    decision: r["decision"] as "approve" | "reject",
    reviewerId: r["reviewer_id"] as string,
    note: r["note"] as string,
    decidedAt: r["decided_at"] as string,
  }));
}

export function insertDisposition(tx: Tx, d: DispositionRecord): void {
  tx.prepare(
    "INSERT INTO lint_disposition (id, sentence_hash, rule_id, reason, reviewer_id, decided_at) VALUES (?,?,?,?,?,?)",
  ).run(d.id, d.sentenceHash, d.ruleId, d.reason, d.reviewerId, d.decidedAt);
}

export function listDispositions(tx: Tx): DispositionRecord[] {
  return (
    tx.prepare("SELECT * FROM lint_disposition ORDER BY decided_at, rowid").all() as Row[]
  ).map((r) => ({
    id: r["id"] as string,
    sentenceHash: r["sentence_hash"] as string,
    ruleId: r["rule_id"] as string,
    reason: r["reason"] as string,
    reviewerId: r["reviewer_id"] as string,
    decidedAt: r["decided_at"] as string,
  }));
}

const phraseList = (r: Row): PhraseListRecord => ({
  version: r["version"] as number,
  rules: JSON.parse(r["rules_json"] as string) as PhraseRule[],
  owner: r["owner"] as string,
  reviewedBy: r["reviewed_by"] as string,
  reviewedAt: r["reviewed_at"] as string,
  createdBy: r["created_by"] as string,
  createdAt: r["created_at"] as string,
  note: r["note"] as string | null,
});

/** The current list is the highest version. */
export function currentPhraseList(tx: Tx): PhraseListRecord {
  const row = tx
    .prepare("SELECT * FROM restricted_phrase_list ORDER BY version DESC LIMIT 1")
    .get() as Row | undefined;
  if (!row) throw new Error("restricted phrase list is not seeded");
  return phraseList(row);
}

export function insertPhraseList(tx: Tx, l: Omit<PhraseListRecord, "version">): number {
  const next = (
    tx.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM restricted_phrase_list").get() as {
      v: number;
    }
  ).v;
  tx.prepare(
    "INSERT INTO restricted_phrase_list (version, rules_json, owner, reviewed_by, reviewed_at, created_by, created_at, note) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    next,
    JSON.stringify(l.rules),
    l.owner,
    l.reviewedBy,
    l.reviewedAt,
    l.createdBy,
    l.createdAt,
    l.note,
  );
  return next;
}
