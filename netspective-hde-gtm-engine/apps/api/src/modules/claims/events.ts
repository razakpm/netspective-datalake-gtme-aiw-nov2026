import type { Tx } from "@gtm/db";
import {
  toClaimCreatedPayload,
  toClaimNeedsReviewPayload,
  toClaimReviewedPayload,
  type ActorType,
  type ClaimClass,
  type ClaimStatus,
} from "@gtm/domain";
import { writeOutbox } from "../../platform/events/outbox.js";

// Outbox events of the claims module (feature 005). Identifiers only: no claim, note or evidence text.
interface Ctx {
  actorId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
}
const base = (c: Ctx, type: string) => ({
  type,
  actor: { id: c.actorId, type: c.actorType },
  correlation_id: c.correlationId,
  causation_id: null,
  idempotency_key: null,
  provenance: { source: "claims" },
});

export function emitClaimCreated(
  tx: Tx,
  c: Ctx,
  p: { claimId: string; effectiveClass: ClaimClass },
): void {
  writeOutbox(
    tx,
    {
      ...base(c, "claim.created"),
      payload: toClaimCreatedPayload({ claim_id: p.claimId, effective_class: p.effectiveClass }),
    },
    c.now,
  );
}

export function emitClaimReviewed(
  tx: Tx,
  c: Ctx,
  p: { claimId: string; decision: "approve" | "reject"; claimStatus: ClaimStatus },
): void {
  writeOutbox(
    tx,
    {
      ...base(c, "claim.reviewed"),
      payload: toClaimReviewedPayload({
        claim_id: p.claimId,
        decision: p.decision,
        claim_status: p.claimStatus,
      }),
    },
    c.now,
  );
}

export function emitClaimNeedsReview(tx: Tx, c: Ctx, p: { claimId: string }): void {
  writeOutbox(
    tx,
    {
      ...base(c, "claim.needs_review"),
      payload: toClaimNeedsReviewPayload({ claim_id: p.claimId }),
    },
    c.now,
  );
}
