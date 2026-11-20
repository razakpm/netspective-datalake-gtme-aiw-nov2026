import { createHash } from "node:crypto";
import type { Tx } from "@gtm/db";
import {
  effectiveClass as combineClass,
  flagIsCovered,
  hasValidEvidence,
  isRestrictedClass,
  lintText,
  normaliseForCompare,
  splitSentences,
  type ClaimClass,
  type ClaimStatus,
  type CoverClaim,
  type LintMatch,
} from "@gtm/domain";
import {
  currentPhraseList,
  listClaims,
  listDispositions,
  listEvidence,
  listReviews,
  type ClaimRecord,
  type EvidenceRecord,
} from "./repository.js";

// Read-side rules of the claims module: the computed `needs_review` status, the claim view, and the check
// of a text against the current phrase list, approved claims and false-positive dispositions.

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const stateOf = (e: EvidenceRecord) => ({
  withdrawn: e.withdrawnAt !== null,
  expiresAt: e.expiresAt,
});

/** `needs_review` is computed, never stored: an approved claim whose evidence is all withdrawn or expired. */
export function effectiveStatus(
  claim: ClaimRecord,
  evidence: readonly EvidenceRecord[],
  now: string,
): ClaimStatus | "needs_review" {
  return claim.status === "approved" && !hasValidEvidence(evidence.map(stateOf), now)
    ? "needs_review"
    : claim.status;
}

export interface ClaimView {
  id: string;
  text: string;
  declaredClass: ClaimClass | null;
  effectiveClass: ClaimClass;
  status: ClaimStatus | "needs_review";
  restricted: boolean;
  approvalsNeeded: number;
  approvalsHave: number;
  draftedBy: string;
  draftedAt: string;
  versionNo: number;
}

export function claimView(tx: Tx, claim: ClaimRecord, now: string): ClaimView {
  const approvers = new Set(
    listReviews(tx, claim.id)
      .filter((r) => r.decision === "approve")
      .map((r) => r.reviewerId),
  );
  return {
    ...claim,
    status: effectiveStatus(claim, listEvidence(tx, claim.id), now),
    restricted: isRestrictedClass(claim.effectiveClass),
    approvalsNeeded: isRestrictedClass(claim.effectiveClass) ? 2 : 1,
    approvalsHave: approvers.size,
  };
}

/** Approved claims whose evidence is still valid: the only claims that can cover text. */
export function usableClaims(tx: Tx, now: string): CoverClaim[] {
  return listClaims(tx, { status: "approved" })
    .filter((c) => hasValidEvidence(listEvidence(tx, c.id).map(stateOf), now))
    .map((c) => ({ text: c.text, effectiveClass: c.effectiveClass, usable: true }));
}

export interface CheckedMatch extends LintMatch {
  /** True when the whole sentence equals an approved claim or the flag was dismissed as a false positive. */
  covered: boolean;
}
export interface CheckResult {
  listVersion: number;
  matches: CheckedMatch[];
}

/** Run the checker with the current phrase list and mark each flag covered or not (research R-04). */
export function checkText(tx: Tx, text: string, now: string): CheckResult {
  const list = currentPhraseList(tx);
  const matches = lintText(text, { rules: list.rules });
  if (matches.length === 0) return { listVersion: list.version, matches: [] };
  const sentences = splitSentences(text);
  const claims = usableClaims(tx, now);
  const dispositions = listDispositions(tx);
  return {
    listVersion: list.version,
    matches: matches.map((m) => {
      const sentence = sentences.find((s) => m.start >= s.start && m.end <= s.end)?.text ?? m.text;
      return {
        ...m,
        covered: flagIsCovered({ sentence, ruleId: m.rule, claims, dispositions, hash: sha256 }),
      };
    }),
  };
}

export { combineClass };

export interface CoverEntry {
  rule: string;
  /** Identifiers only: the claims whose text equals the flagged sentence. */
  claimIds: string[];
}
export interface CoverReport {
  covered: CoverEntry[];
  uncovered: CoverEntry[];
}

/**
 * Re-check a text against the claims as they are now, for read-time warnings (spec FR-008). Covered flags
 * list the usable claims behind them; uncovered ones list every claim with the same sentence, whatever its
 * state, so a lapsed claim can be found. Nothing is stored.
 */
export function coverReport(tx: Tx, text: string, now: string): CoverReport {
  const list = currentPhraseList(tx);
  const matches = lintText(text, { rules: list.rules });
  const report: CoverReport = { covered: [], uncovered: [] };
  if (matches.length === 0) return report;
  const sentences = splitSentences(text);
  const usable = new Set(
    listClaims(tx, { status: "approved" })
      .filter((c) => hasValidEvidence(listEvidence(tx, c.id).map(stateOf), now))
      .map((c) => c.id),
  );
  const all = listClaims(tx);
  const dispositions = listDispositions(tx);
  for (const m of matches) {
    const sentence = sentences.find((s) => m.start >= s.start && m.end <= s.end)?.text ?? m.text;
    const target = normaliseForCompare(sentence);
    const same = all.filter((c) => normaliseForCompare(c.text) === target);
    const covered = flagIsCovered({
      sentence,
      ruleId: m.rule,
      claims: usableClaims(tx, now),
      dispositions,
      hash: sha256,
    });
    if (covered) {
      report.covered.push({
        rule: m.rule,
        claimIds: same.filter((c) => usable.has(c.id)).map((c) => c.id),
      });
    } else {
      report.uncovered.push({ rule: m.rule, claimIds: same.map((c) => c.id) });
    }
  }
  return report;
}
