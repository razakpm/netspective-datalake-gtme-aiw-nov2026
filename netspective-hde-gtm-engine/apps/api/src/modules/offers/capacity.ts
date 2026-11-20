import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  capacityState,
  limitInForce,
  localDateOf,
  periodFor,
  periodForLocalDate,
  usageOf,
  type CapacityLimit,
  type CapacityStateName,
  type OfferStatus,
  type PeriodKind,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { HttpError, parseOrThrow } from "../../http/errors.js";
import {
  audited,
  guardFreeText,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { recordAudit } from "../audit/index.js";
import { ctxOf, emitCapacityChanged } from "./events.js";
import { offerSummary } from "./queries.js";
import {
  getHead,
  insertCapacity,
  listBookings,
  listCapacity,
  type CapacityRow,
} from "./repository.js";

// Capacity limits and the computed capacity status (feature 005, task T041). Usage is computed from
// bookings; feature 006 asks `capacityStatus` whether an offer is exhausted.

export const LimitInputSchema = z
  .object({
    periodKind: z.enum(["week", "month"]),
    limitSessions: z.number().int().min(0).max(1000),
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    reason: z.string().min(3).max(300).optional(),
  })
  .strict();

export interface CapacitySettings {
  businessTimeZone: string;
}

export interface CapacityStatus {
  offerId: string;
  state: CapacityStateName;
  periodKind: PeriodKind | null;
  periodStart: string | null;
  periodEnd: string | null;
  limit: number | null;
  used: number;
  held: number;
  remaining: number | null;
  utilisation: number | null;
  /** The offer's status (in-force version, else latest), so a consumer can tell it is not available. */
  offerStatus: OfferStatus;
}

const asLimit = (c: CapacityRow): CapacityLimit => ({
  periodKind: c.periodKind,
  limitSessions: c.limitSessions,
  effectiveFrom: c.effectiveFrom,
  setAt: c.setAt,
});

export class CapacityService {
  constructor(
    readonly db: SqliteDatabase,
    readonly settings: CapacitySettings,
  ) {}

  /** The local calendar date of `at` in the business time zone. */
  today(at: Date): string {
    return localDateOf(at, this.settings.businessTimeZone);
  }

  statusIn(tx: Tx, offerId: string, at: Date): CapacityStatus {
    const head = getHead(tx, offerId);
    if (!head) throw new HttpError(404, "Offer not found");
    const day = this.today(at);
    const limit = limitInForce(listCapacity(tx, offerId).map(asLimit), day);
    // With no limit the month is shown, so a consumer still sees usage; the state says there is no limit.
    const period = limit
      ? periodForLocalDate(day, limit.periodKind)
      : periodFor(at, "month", this.settings.businessTimeZone);
    const usage = usageOf(listBookings(tx, offerId), period);
    return {
      offerId,
      ...capacityState(limit?.limitSessions ?? null, usage),
      periodKind: period.kind,
      periodStart: period.start,
      periodEnd: period.end,
      offerStatus: offerSummary(tx, head, at.toISOString()).status,
    };
  }

  /** The public question for feature 006: is this offer full for the period containing `at`? */
  capacityStatus(offerId: string, at: Date): CapacityStatus {
    return this.db.transaction((tx) => this.statusIn(tx, offerId, at));
  }

  listLimits(actor: CatalogueActor, offerId: string): CapacityRow[] {
    return audited(this.db, actor, "offer.read.refused", "engagement_offer", offerId, () => {
      requirePermission(actor, "offers.read");
      return this.db.transaction((tx) => {
        if (!getHead(tx, offerId)) throw new HttpError(404, "Offer not found");
        return listCapacity(tx, offerId);
      });
    });
  }

  setLimit(actor: CatalogueActor, offerId: string, raw: unknown): CapacityRow {
    const input = parseOrThrow(LimitInputSchema, raw);
    return audited(
      this.db,
      actor,
      "offer.capacity.set.refused",
      "engagement_offer",
      offerId,
      () => {
        requirePermission(actor, "offers.capacity.edit");
        if (input.reason) guardFreeText({ reason: input.reason });
        const now = nowOf(actor);
        const row: CapacityRow = {
          id: uuidv7(),
          offerId,
          periodKind: input.periodKind,
          limitSessions: input.limitSessions,
          effectiveFrom: input.effectiveFrom ?? this.today(now),
          setBy: actor.userId as string,
          setAt: now.toISOString(),
          reason: input.reason ?? null,
        };
        return this.db.transaction((tx) => {
          if (!getHead(tx, offerId)) throw new HttpError(404, "Offer not found");
          insertCapacity(tx, row);
          recordAudit(
            tx,
            {
              actorId: actor.userId,
              actorType: actor.actorType,
              action: "offer.capacity.set",
              entityType: "engagement_offer",
              entityId: offerId,
              outcome: "success",
              after: {
                period_kind: row.periodKind,
                limit_sessions: row.limitSessions,
                effective_from: row.effectiveFrom,
              },
              correlationId: actor.correlationId,
            },
            actor.now,
          );
          emitCapacityChanged(tx, ctxOf(actor), {
            offerId,
            periodKind: row.periodKind,
            limitSessions: row.limitSessions,
          });
          return row;
        });
      },
    );
  }
}
