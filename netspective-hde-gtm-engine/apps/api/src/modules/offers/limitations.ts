import type { SqliteDatabase } from "@gtm/db";
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
import { ctxOf, emitOfferUpdated } from "./events.js";
import { limitationView, wordingHash, type LimitationView } from "./queries.js";
import {
  getHead,
  getLimitation,
  insertAck,
  insertLimitation,
  latestAck,
  latestStatus,
  updateLimitationWording,
} from "./repository.js";

// Offer limitations and their acknowledgement (feature 005, task T035). An acknowledgement is valid while
// the wording hash is unchanged; a changed wording makes it stale until a service lead repeats it.

export const LimitationInputSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{3,80}$/),
    wording: z.string().min(3).max(300),
  })
  .strict();
const WordingSchema = z.string().min(3).max(300);

export class OfferLimitations {
  constructor(readonly db: SqliteDatabase) {}

  /** The version whose status the change event reports: the offer's latest. */
  private eventTarget(
    tx: Parameters<Parameters<SqliteDatabase["transaction"]>[0]>[0],
    offerId: string,
  ) {
    const head = getHead(tx, offerId) as NonNullable<ReturnType<typeof getHead>>;
    return {
      versionNo: head.latestVersionNo,
      status: latestStatus(tx, offerId, head.latestVersionNo).status,
    };
  }

  add(actor: CatalogueActor, offerId: string, raw: unknown): LimitationView {
    const input = parseOrThrow(LimitationInputSchema, raw);
    return audited(
      this.db,
      actor,
      "offer.limitation.add.refused",
      "engagement_offer",
      offerId,
      () => {
        requirePermission(actor, "offers.edit");
        guardFreeText({ wording: input.wording });
        return this.db.transaction((tx) => {
          if (!getHead(tx, offerId))
            throw new CatalogueRefusal(404, "Offer not found", ["not_found"]);
          const id = uuidv7();
          try {
            insertLimitation(tx, {
              id,
              offerId,
              key: input.key,
              wording: input.wording,
              active: true,
            });
          } catch {
            throw new CatalogueRefusal(409, "Limitation exists", ["limitation_exists"]);
          }
          recordAudit(
            tx,
            {
              actorId: actor.userId,
              actorType: actor.actorType,
              action: "offer.limitation.add",
              entityType: "engagement_offer",
              entityId: offerId,
              outcome: "success",
              after: { limitation_id: id, key: input.key },
              correlationId: actor.correlationId,
            },
            actor.now,
          );
          emitOfferUpdated(tx, ctxOf(actor), {
            offerId,
            change: "limitation",
            ...this.eventTarget(tx, offerId),
          });
          return limitationView(tx, getLimitation(tx, id)!);
        });
      },
    );
  }

  changeWording(actor: CatalogueActor, limitationId: string, rawWording: string): LimitationView {
    const wording = parseOrThrow(WordingSchema, rawWording);
    return audited(
      this.db,
      actor,
      "offer.limitation.change.refused",
      "offer_limitation",
      limitationId,
      () => {
        requirePermission(actor, "offers.edit");
        guardFreeText({ wording });
        return this.db.transaction((tx) => {
          const l = getLimitation(tx, limitationId);
          if (!l) throw new CatalogueRefusal(404, "Limitation not found", ["not_found"]);
          if (l.wording === wording)
            throw new CatalogueRefusal(409, "Nothing changed", ["no_changes"]);
          updateLimitationWording(tx, limitationId, wording);
          recordAudit(
            tx,
            {
              actorId: actor.userId,
              actorType: actor.actorType,
              action: "offer.limitation.change",
              entityType: "offer_limitation",
              entityId: limitationId,
              outcome: "success",
              before: { wording_hash: wordingHash(l.wording) },
              after: { wording_hash: wordingHash(wording) },
              correlationId: actor.correlationId,
            },
            actor.now,
          );
          emitOfferUpdated(tx, ctxOf(actor), {
            offerId: l.offerId,
            change: "limitation",
            ...this.eventTarget(tx, l.offerId),
          });
          return limitationView(tx, getLimitation(tx, limitationId)!);
        });
      },
    );
  }

  /** A service lead acknowledges the current wording; repeating a valid acknowledgement changes nothing. */
  acknowledge(actor: CatalogueActor, limitationId: string): LimitationView {
    return audited(
      this.db,
      actor,
      "offer.limitation.acknowledge.refused",
      "offer_limitation",
      limitationId,
      () => {
        requirePermission(actor, "offers.limitations.acknowledge");
        const at = nowOf(actor).toISOString();
        return this.db.transaction((tx) => {
          const l = getLimitation(tx, limitationId);
          if (!l) throw new CatalogueRefusal(404, "Limitation not found", ["not_found"]);
          const hash = wordingHash(l.wording);
          const existing = latestAck(tx, limitationId);
          if (existing && existing.wordingHash === hash) return limitationView(tx, l);
          insertAck(tx, {
            id: uuidv7(),
            limitationId,
            wordingHash: hash,
            acknowledgedBy: actor.userId as string,
            acknowledgedAt: at,
          });
          recordAudit(
            tx,
            {
              actorId: actor.userId,
              actorType: actor.actorType,
              action: "offer.limitation.acknowledge",
              entityType: "offer_limitation",
              entityId: limitationId,
              outcome: "success",
              after: { wording_hash: hash },
              correlationId: actor.correlationId,
            },
            actor.now,
          );
          emitOfferUpdated(tx, ctxOf(actor), {
            offerId: l.offerId,
            change: "limitation",
            ...this.eventTarget(tx, l.offerId),
          });
          return limitationView(tx, l);
        });
      },
    );
  }
}
