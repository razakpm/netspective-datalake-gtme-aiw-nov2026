import type { Tx } from "@gtm/db";
import {
  toOfferCapacityChangedPayload,
  toOfferRecommendedPayload,
  toOfferUpdatedPayload,
  type ActorType,
  type OfferStatus,
} from "@gtm/domain";
import { writeOutbox } from "../../platform/events/outbox.js";

// Outbox events of the offers module (feature 005). Identifiers only: no offer, note or limitation text.
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
  provenance: { source: "offers" },
});

export function emitOfferUpdated(
  tx: Tx,
  c: Ctx,
  p: {
    offerId: string;
    versionNo: number;
    change: "version" | "status" | "limitation" | "score";
    status: OfferStatus;
  },
): void {
  writeOutbox(
    tx,
    {
      ...base(c, "offer.updated"),
      payload: toOfferUpdatedPayload({
        offer_id: p.offerId,
        version_no: p.versionNo,
        change: p.change,
        status: p.status,
      }),
    },
    c.now,
  );
}

export function emitCapacityChanged(
  tx: Tx,
  c: Ctx,
  p: { offerId: string; periodKind: "week" | "month"; limitSessions: number },
): void {
  writeOutbox(
    tx,
    {
      ...base(c, "offer.capacity.changed"),
      payload: toOfferCapacityChangedPayload({
        offer_id: p.offerId,
        period_kind: p.periodKind,
        limit_sessions: p.limitSessions,
      }),
    },
    c.now,
  );
}

export const ctxOf = (a: {
  userId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
}): Ctx => ({
  actorId: a.userId,
  actorType: a.actorType,
  correlationId: a.correlationId,
  now: a.now,
});

export function emitOfferRecommended(
  tx: Tx,
  c: Ctx,
  p: {
    recommendationId: string;
    accountId: string;
    outcome: "offer" | "research" | "no_action";
    outreach: "allowed" | "blocked";
    ruleSetVersion: number;
  },
): void {
  writeOutbox(
    tx,
    {
      ...base(c, "offer.recommended"),
      payload: toOfferRecommendedPayload({
        recommendation_id: p.recommendationId,
        account_id: p.accountId,
        outcome: p.outcome,
        outreach: p.outreach,
        rule_set_version: p.ruleSetVersion,
      }),
    },
    c.now,
  );
}
