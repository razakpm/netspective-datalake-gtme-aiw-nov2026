import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  effectiveClass,
  evaluateClaimApproval,
  isRestrictedClass,
  lintText,
  RestrictedPhraseListSchema,
  sentenceHash,
  type Permission,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { parseOrThrow } from "../../http/errors.js";
import {
  audited,
  CatalogueRefusal,
  guardFreeText,
  holds,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { recordAudit } from "../audit/index.js";
import { emitClaimReviewed } from "./events.js";
import { sha256 } from "./queries.js";
import {
  currentPhraseList,
  getClaim,
  getEvidence,
  insertDisposition,
  insertPhraseList,
  insertReview,
  listEvidence,
  listReviews,
  setClaimStatus,
  setEffectiveClass,
  withdrawEvidence,
  type PhraseListRecord,
} from "./repository.js";
import type { ClaimDetailView, ClaimService } from "./service.js";

// Review of claims (feature 005, task T051): the two-person rule for restricted claims, withdrawal,
// false-positive dispositions and publication of a new phrase list version. Each action is audited in
// the same transaction; reviews, dispositions and list versions are append-only.

export const ReviewInputSchema = z
  .object({ decision: z.enum(["approve", "reject"]), note: z.string().min(3).max(500) })
  .strict();
export const WithdrawInputSchema = z.object({ note: z.string().min(3).max(500) }).strict();
export const DispositionInputSchema = z
  .object({
    sentence: z.string().min(1).max(1000),
    ruleId: z.string().min(1).max(64),
    reason: z.string().min(3).max(300),
  })
  .strict();
export const PublishListSchema = z
  .object({
    rules: z.array(z.unknown()).min(1).max(200),
    reviewerId: z.string().min(1).max(100),
    note: z.string().min(3).max(300),
  })
  .strict();

const REVIEW_MESSAGES: Record<string, string> = {
  claim_needs_evidence: "Link valid evidence before approving. Omit the statement until then.",
  drafter_cannot_approve: "The person who drafted a claim cannot review it.",
  already_reviewed: "You have already reviewed this claim.",
  rejected: "This claim was rejected and cannot be reviewed again. Draft a new claim.",
};

/** The permissions a person holds through their active roles (looked up for the named phrase list reviewer). */
export type PermissionsOf = (tx: Tx, userId: string) => readonly Permission[];

export const sqlPermissionsOf: PermissionsOf = (tx, userId) =>
  (
    tx
      .prepare(
        "SELECT DISTINCT rp.permission_key AS k FROM user u JOIN user_role ur ON ur.user_id = u.id JOIN role_permission rp ON rp.role_id = ur.role_id WHERE u.id = ? AND u.status = 'active'",
      )
      .all(userId) as { k: Permission }[]
  ).map((r) => r.k);

export class ClaimReviewService {
  constructor(
    readonly db: SqliteDatabase,
    readonly claims: ClaimService,
    readonly permissionsOf: PermissionsOf = sqlPermissionsOf,
  ) {}

  private audit(
    tx: Tx,
    actor: CatalogueActor,
    action: string,
    entityId: string | null,
    after: Record<string, unknown>,
  ): void {
    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: actor.actorType,
        action,
        entityType: "claim",
        entityId,
        outcome: "success",
        after,
        correlationId: actor.correlationId,
      },
      actor.now,
    );
  }

  review(actor: CatalogueActor, claimId: string, raw: unknown): ClaimDetailView {
    const input = parseOrThrow(ReviewInputSchema, raw);
    return audited(this.db, actor, "claim.review.refused", "claim", claimId, () => {
      requirePermission(actor, "claims.approve");
      guardFreeText({ note: input.note });
      const now = nowOf(actor);
      const at = now.toISOString();
      return this.db.transaction((tx) => {
        const claim = getClaim(tx, claimId);
        if (!claim) throw new CatalogueRefusal(404, "Claim not found", ["not_found"]);
        if (
          claim.status === "approved" ||
          claim.status === "rejected" ||
          claim.status === "withdrawn"
        ) {
          throw new CatalogueRefusal(
            409,
            "Claim already decided",
            ["claim_closed"],
            [],
            `This claim is already ${claim.status}.`,
          );
        }
        // A claim is never lower than what the checker finds now: a grown list can make an old draft restricted.
        const found = lintText(claim.text, { rules: currentPhraseList(tx).rules }).map(
          (m) => m.class,
        );
        const fresh = effectiveClass(claim.declaredClass, found);
        const eff = isRestrictedClass(claim.effectiveClass) ? claim.effectiveClass : fresh;
        const result = evaluateClaimApproval({
          draftedBy: claim.draftedBy,
          effectiveClass: eff,
          evidence: listEvidence(tx, claimId).map((e) => ({
            withdrawn: e.withdrawnAt !== null,
            expiresAt: e.expiresAt,
          })),
          priorReviews: listReviews(tx, claimId).map((r) => ({
            reviewerId: r.reviewerId,
            decision: r.decision,
          })),
          reviewerId: actor.userId as string,
          decision: input.decision,
          now: at,
        });
        if (!result.ok) {
          throw new CatalogueRefusal(
            409,
            "Review refused",
            result.codes,
            [],
            result.codes.map((c) => REVIEW_MESSAGES[c] ?? c).join(" "),
          );
        }
        insertReview(tx, {
          id: uuidv7(),
          claimId,
          decision: input.decision,
          reviewerId: actor.userId as string,
          note: input.note,
          decidedAt: at,
        });
        if (eff !== claim.effectiveClass) setEffectiveClass(tx, claimId, eff);
        if (result.status !== claim.status) setClaimStatus(tx, claimId, result.status);
        this.audit(tx, actor, "claim.review", claimId, {
          decision: input.decision,
          status: result.status,
          approvals: result.approvals,
        });
        emitClaimReviewed(tx, ctx(actor), {
          claimId,
          decision: input.decision,
          claimStatus: result.status,
        });
        return this.claims.detail(tx, getClaim(tx, claimId)!, at);
      });
    });
  }

  /** A drafter may withdraw a draft; withdrawing an approved claim needs claims.approve. */
  withdraw(actor: CatalogueActor, claimId: string, raw: unknown): ClaimDetailView {
    const input = parseOrThrow(WithdrawInputSchema, raw);
    return audited(this.db, actor, "claim.withdraw.refused", "claim", claimId, () => {
      guardFreeText({ note: input.note });
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        const claim = getClaim(tx, claimId);
        if (!claim) throw new CatalogueRefusal(404, "Claim not found", ["not_found"]);
        this.needRight(actor, claim.status === "approved");
        if (claim.status === "withdrawn" || claim.status === "rejected") {
          throw new CatalogueRefusal(
            409,
            "Claim is closed",
            ["claim_closed"],
            [],
            `This claim is already ${claim.status}.`,
          );
        }
        setClaimStatus(tx, claimId, "withdrawn");
        this.audit(tx, actor, "claim.withdraw", claimId, { from: claim.status });
        return this.claims.detail(tx, getClaim(tx, claimId)!, at);
      });
    });
  }

  /** Evidence is withdrawn once; on an approved claim that makes it read as needs_review. */
  withdrawEvidence(actor: CatalogueActor, claimId: string, evidenceId: string): ClaimDetailView {
    return audited(this.db, actor, "claim.evidence.withdraw.refused", "claim", claimId, () => {
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        const claim = getClaim(tx, claimId);
        if (!claim) throw new CatalogueRefusal(404, "Claim not found", ["not_found"]);
        this.needRight(actor, claim.status === "approved");
        const evidence = getEvidence(tx, evidenceId);
        if (!evidence || evidence.claimId !== claimId)
          throw new CatalogueRefusal(404, "Evidence not found", ["not_found"]);
        if (evidence.withdrawnAt !== null) {
          throw new CatalogueRefusal(
            409,
            "Evidence already withdrawn",
            ["already_withdrawn"],
            [],
            "This evidence is already withdrawn.",
          );
        }
        withdrawEvidence(tx, evidenceId, actor.userId as string, at);
        this.audit(tx, actor, "claim.evidence.withdraw", claimId, { evidence_id: evidenceId });
        return this.claims.detail(tx, claim, at);
      });
    });
  }

  private needRight(actor: CatalogueActor, approved: boolean): void {
    if (approved) requirePermission(actor, "claims.approve");
    else if (!holds(actor, "claims.draft")) requirePermission(actor, "claims.approve");
  }

  /** A designated approver marks a flag a false positive for one exact sentence and rule. */
  markFalsePositive(actor: CatalogueActor, raw: unknown): string {
    const input = parseOrThrow(DispositionInputSchema, raw);
    return audited(this.db, actor, "claim.disposition.refused", "claim", null, () => {
      requirePermission(actor, "claims.approve");
      guardFreeText({ sentence: input.sentence, reason: input.reason });
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        const flags = lintText(input.sentence, { rules: currentPhraseList(tx).rules });
        if (!flags.some((m) => m.rule === input.ruleId)) {
          throw new CatalogueRefusal(
            400,
            "No such flag",
            ["no_such_flag"],
            [],
            "That rule does not flag this sentence.",
          );
        }
        const id = uuidv7();
        insertDisposition(tx, {
          id,
          sentenceHash: sentenceHash(input.sentence, sha256),
          ruleId: input.ruleId,
          reason: input.reason,
          reviewerId: actor.userId as string,
          decidedAt: at,
        });
        this.audit(tx, actor, "claim.disposition", id, { rule_id: input.ruleId });
        return id;
      });
    });
  }

  getPhraseList(actor: CatalogueActor): PhraseListRecord {
    return audited(this.db, actor, "claim.read.refused", "claim", null, () => {
      requirePermission(actor, "claims.read");
      return this.db.transaction((tx) => currentPhraseList(tx));
    });
  }

  /** The marketing approver publishes a new immutable version; a named second approver reviews it. */
  publishPhraseList(actor: CatalogueActor, raw: unknown): PhraseListRecord {
    const input = parseOrThrow(PublishListSchema, raw);
    const list = parseOrThrow(RestrictedPhraseListSchema, { rules: input.rules });
    return audited(this.db, actor, "claim.phrase_list.publish.refused", "claim", null, () => {
      requirePermission(actor, "claims.phrases.manage");
      guardFreeText({ note: input.note });
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        if (input.reviewerId === actor.userId) {
          throw new CatalogueRefusal(
            400,
            "Reviewer required",
            ["reviewer_is_author"],
            [],
            "A reviewer other than the author must be named.",
          );
        }
        if (!this.permissionsOf(tx, input.reviewerId).includes("claims.approve")) {
          throw new CatalogueRefusal(
            400,
            "Reviewer not designated",
            ["reviewer_not_designated"],
            [],
            "The reviewer must be a designated approver (holds claims.approve).",
          );
        }
        const version = insertPhraseList(tx, {
          rules: list.rules,
          owner: currentPhraseList(tx).owner,
          reviewedBy: input.reviewerId,
          reviewedAt: at,
          createdBy: actor.userId as string,
          createdAt: at,
          note: input.note,
        });
        this.audit(tx, actor, "claim.phrase_list.publish", null, {
          version,
          reviewed_by: input.reviewerId,
        });
        return currentPhraseList(tx);
      });
    });
  }
}

const ctx = (a: CatalogueActor) => ({
  actorId: a.userId,
  actorType: a.actorType,
  correlationId: a.correlationId,
  now: a.now,
});
