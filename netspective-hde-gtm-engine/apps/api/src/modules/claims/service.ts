import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  effectiveClass,
  lintText,
  CLAIM_CLASSES,
  type ClaimStatus,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { parseOrThrow } from "../../http/errors.js";
import {
  audited,
  CatalogueRefusal,
  guardFreeText,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { recordAudit } from "../audit/index.js";
import { emitClaimCreated } from "./events.js";
import {
  checkText,
  claimView,
  effectiveStatus,
  type CheckResult,
  type ClaimView,
} from "./queries.js";
import {
  currentPhraseList,
  getClaim,
  insertClaim,
  insertEvidence,
  listClaims,
  listEvidence,
  listReviews,
  updateClaimText,
  type ClaimRecord,
  type EvidenceRecord,
  type ReviewRecord,
} from "./repository.js";

// Claims: draft, edit while a draft, add evidence and read models (feature 005, tasks T026 and T051).
// Review, withdrawal and the phrase list are in review.ts. Everything is audited in the same transaction.

export const ClaimInputSchema = z
  .object({
    text: z.string().min(3).max(600),
    declaredClass: z.enum(CLAIM_CLASSES).optional(),
  })
  .strict();
export const EvidenceInputSchema = z
  .object({
    kind: z.enum(["document", "published_page", "internal_record", "approved_case_study"]),
    reference: z.string().min(3).max(300),
    owner: z.string().min(2).max(120),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
export type ClaimInput = z.infer<typeof ClaimInputSchema>;
export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;

export interface ClaimSettings {
  evidenceDefaultExpiryMonths: number;
}

export interface EvidenceView {
  id: string;
  kind: string;
  reference: string;
  owner: string;
  expiresAt: string;
  withdrawnAt: string | null;
  valid: boolean;
}
export interface ClaimDetailView extends ClaimView {
  evidence: EvidenceView[];
  reviews: Pick<ReviewRecord, "decision" | "reviewerId" | "note" | "decidedAt">[];
  lint: CheckResult;
  suggestion?: string;
}

export const addMonthsUtc = (from: Date, months: number): Date => {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
};

const evidenceView = (e: EvidenceRecord, now: string): EvidenceView => ({
  id: e.id,
  kind: e.kind,
  reference: e.reference,
  owner: e.owner,
  expiresAt: e.expiresAt,
  withdrawnAt: e.withdrawnAt,
  valid: e.withdrawnAt === null && Date.parse(e.expiresAt) > Date.parse(now),
});

export class ClaimService {
  constructor(
    readonly db: SqliteDatabase,
    readonly settings: ClaimSettings,
  ) {}

  /** The foundation of every read model: no permission check, so services can reuse it. */
  detail(tx: Tx, claim: ClaimRecord, now: string): ClaimDetailView {
    const evidence = listEvidence(tx, claim.id);
    const view = claimView(tx, claim, now);
    const detail: ClaimDetailView = {
      ...view,
      evidence: evidence.map((e) => evidenceView(e, now)),
      reviews: listReviews(tx, claim.id).map((r) => ({
        decision: r.decision,
        reviewerId: r.reviewerId,
        note: r.note,
        decidedAt: r.decidedAt,
      })),
      lint: checkText(tx, claim.text, now),
    };
    if (effectiveStatus(claim, evidence, now) !== "approved") {
      detail.suggestion = "Omit the statement until it is approved with valid evidence.";
    }
    return detail;
  }

  draft(actor: CatalogueActor, raw: unknown): ClaimDetailView {
    const input = parseOrThrow(ClaimInputSchema, raw);
    return audited(this.db, actor, "claim.draft.refused", "claim", null, () => {
      requirePermission(actor, "claims.draft");
      guardFreeText({ text: input.text });
      const id = uuidv7();
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        const list = currentPhraseList(tx);
        const found = lintText(input.text, { rules: list.rules }).map((m) => m.class);
        const effective = effectiveClass(input.declaredClass ?? null, found);
        insertClaim(tx, {
          id,
          text: input.text,
          declaredClass: input.declaredClass ?? null,
          effectiveClass: effective,
          status: "draft",
          draftedBy: actor.userId as string,
          draftedAt: at,
        });
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "claim.draft",
            entityType: "claim",
            entityId: id,
            outcome: "success",
            after: { effective_class: effective, status: "draft" },
            correlationId: actor.correlationId,
          },
          actor.now,
        );
        emitClaimCreated(tx, { ...ctx(actor) }, { claimId: id, effectiveClass: effective });
        return this.detail(tx, getClaim(tx, id) as ClaimRecord, at);
      });
    });
  }

  /** Text may change only while the claim is a draft; an approved claim is replaced by a new one. */
  edit(actor: CatalogueActor, id: string, raw: unknown, expectedVersion: number): ClaimDetailView {
    const input = parseOrThrow(ClaimInputSchema, raw);
    return audited(this.db, actor, "claim.edit.refused", "claim", id, () => {
      requirePermission(actor, "claims.draft");
      guardFreeText({ text: input.text });
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        const claim = getClaim(tx, id);
        if (!claim) throw new CatalogueRefusal(404, "Claim not found", ["not_found"]);
        if (claim.status !== "draft") {
          throw new CatalogueRefusal(
            409,
            "Claim cannot be edited",
            ["claim_not_editable"],
            [],
            "Only a draft can be edited. Draft a new claim instead.",
          );
        }
        const list = currentPhraseList(tx);
        const found = lintText(input.text, { rules: list.rules }).map((m) => m.class);
        const effective = effectiveClass(input.declaredClass ?? null, found);
        const ok = updateClaimText(tx, id, expectedVersion, {
          text: input.text,
          declaredClass: input.declaredClass ?? null,
          effectiveClass: effective,
        });
        if (!ok)
          throw new CatalogueRefusal(
            409,
            "Stale version",
            ["stale_version"],
            [],
            "The claim changed. Reload and try again.",
          );
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "claim.edit",
            entityType: "claim",
            entityId: id,
            outcome: "success",
            after: { effective_class: effective },
            correlationId: actor.correlationId,
          },
          actor.now,
        );
        return this.detail(tx, getClaim(tx, id) as ClaimRecord, at);
      });
    });
  }

  addEvidence(actor: CatalogueActor, claimId: string, raw: unknown): ClaimDetailView {
    const input = parseOrThrow(EvidenceInputSchema, raw);
    return audited(this.db, actor, "claim.evidence.add.refused", "claim", claimId, () => {
      requirePermission(actor, "claims.draft");
      guardFreeText({ reference: input.reference, owner: input.owner });
      const now = nowOf(actor);
      const at = now.toISOString();
      return this.db.transaction((tx) => {
        const claim = getClaim(tx, claimId);
        if (!claim) throw new CatalogueRefusal(404, "Claim not found", ["not_found"]);
        if (claim.status === "withdrawn" || claim.status === "rejected") {
          throw new CatalogueRefusal(409, "Claim is closed", ["claim_closed"]);
        }
        const id = uuidv7();
        insertEvidence(tx, {
          id,
          claimId,
          kind: input.kind,
          reference: input.reference,
          owner: input.owner,
          addedBy: actor.userId as string,
          addedAt: at,
          expiresAt:
            input.expiresAt ??
            addMonthsUtc(now, this.settings.evidenceDefaultExpiryMonths).toISOString(),
        });
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "claim.evidence.add",
            entityType: "claim",
            entityId: claimId,
            outcome: "success",
            after: { evidence_id: id, kind: input.kind },
            correlationId: actor.correlationId,
          },
          actor.now,
        );
        return this.detail(tx, claim, at);
      });
    });
  }

  get(actor: CatalogueActor, id: string): ClaimDetailView {
    return audited(this.db, actor, "claim.read.refused", "claim", id, () => {
      requirePermission(actor, "claims.read");
      return this.db.transaction((tx) => {
        const claim = getClaim(tx, id);
        if (!claim) throw new CatalogueRefusal(404, "Claim not found", ["not_found"]);
        return this.detail(tx, claim, nowOf(actor).toISOString());
      });
    });
  }

  list(actor: CatalogueActor, filter: { status?: ClaimStatus | "needs_review" } = {}): ClaimView[] {
    return audited(this.db, actor, "claim.read.refused", "claim", null, () => {
      requirePermission(actor, "claims.read");
      const now = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        const stored = filter.status === "needs_review" ? "approved" : filter.status;
        return listClaims(tx, stored ? { status: stored } : {})
          .map((c) => claimView(tx, c, now))
          .filter((v) => !filter.status || v.status === filter.status);
      });
    });
  }

  /** Run the checker over any text; nothing is stored. The text is refused whole if it matches the PHI guard. */
  lint(actor: CatalogueActor, text: string): CheckResult {
    return audited(this.db, actor, "claim.lint.refused", "claim", null, () => {
      requirePermission(actor, "claims.read");
      guardFreeText({ text });
      return this.db.transaction((tx) => checkText(tx, text, nowOf(actor).toISOString()));
    });
  }
}

const ctx = (a: CatalogueActor) => ({
  actorId: a.userId,
  actorType: a.actorType,
  correlationId: a.correlationId,
  now: a.now,
});
