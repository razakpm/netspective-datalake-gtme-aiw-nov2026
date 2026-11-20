import type { SqliteDatabase, Tx } from "@gtm/db";
import { limitInForce, periodForLocalDate, usageOf, type CapacityLimit } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { HttpError, parseOrThrow } from "../../http/errors.js";
import {
  audited,
  CatalogueRefusal,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { recordAudit } from "../audit/index.js";
import type { CapacitySettings } from "./capacity.js";
import {
  getBooking,
  getHead,
  insertBooking,
  listBookings,
  listCapacity,
  updateBooking,
  type BookingRow,
} from "./repository.js";
import { localDateOf } from "@gtm/domain";

// Session bookings, the usage source for capacity (feature 005, task T041). Until the workshop feature
// exists they are entered by hand and labelled manual. Booking changes are audit-only (spec FR-029).

const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, "must be a real calendar date");

export const BookingInputSchema = z
  .object({
    sessionDate: LocalDate,
    externalRef: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,100}$/)
      .optional(),
  })
  .strict();
export const RescheduleInputSchema = z.object({ sessionDate: LocalDate }).strict();

export type BookingView = BookingRow;

export class BookingService {
  constructor(
    readonly db: SqliteDatabase,
    readonly settings: CapacitySettings,
  ) {}

  private limitNow(tx: Tx, offerId: string, now: Date): CapacityLimit | null {
    const history: CapacityLimit[] = listCapacity(tx, offerId).map((c) => ({
      periodKind: c.periodKind,
      limitSessions: c.limitSessions,
      effectiveFrom: c.effectiveFrom,
      setAt: c.setAt,
    }));
    return limitInForce(history, localDateOf(now, this.settings.businessTimeZone));
  }

  /** Refuse when the period that holds `sessionDate` is already full (excluding the booking being moved). */
  private assertRoom(
    tx: Tx,
    offerId: string,
    sessionDate: string,
    now: Date,
    excludeId?: string,
  ): string {
    const limit = this.limitNow(tx, offerId, now);
    const period = periodForLocalDate(sessionDate, limit?.periodKind ?? "month");
    if (limit) {
      const others = listBookings(tx, offerId).filter((b) => b.id !== excludeId);
      const used = usageOf(others, period).used;
      if (used >= limit.limitSessions) {
        throw new CatalogueRefusal(
          409,
          "Capacity is full",
          ["capacity_exhausted"],
          [],
          `The offer is full for this ${period.kind} (${used} of ${limit.limitSessions} sessions). Choose another period or raise the limit.`,
        );
      }
    }
    return period.start;
  }

  record(actor: CatalogueActor, offerId: string, raw: unknown): BookingView {
    const input = parseOrThrow(BookingInputSchema, raw);
    return audited(
      this.db,
      actor,
      "offer.booking.record.refused",
      "engagement_offer",
      offerId,
      () => {
        requirePermission(actor, "offers.bookings.edit");
        const now = nowOf(actor);
        return this.db.transaction((tx) => {
          if (!getHead(tx, offerId)) throw new HttpError(404, "Offer not found");
          const periodStart = this.assertRoom(tx, offerId, input.sessionDate, now);
          const row: BookingRow = {
            id: uuidv7(),
            offerId,
            externalRef: input.externalRef ?? null,
            state: "booked",
            sessionDate: input.sessionDate,
            periodStart,
            source: "manual",
            recordedBy: actor.userId as string,
            recordedAt: now.toISOString(),
            updatedAt: now.toISOString(),
          };
          try {
            insertBooking(tx, row);
          } catch {
            throw new CatalogueRefusal(
              409,
              "Booking exists",
              ["duplicate_booking"],
              [],
              "A booking with this reference already exists for this offer.",
            );
          }
          this.audit(tx, actor, "offer.booking.record", row, {
            session_date: row.sessionDate,
            source: row.source,
          });
          return row;
        });
      },
    );
  }

  reschedule(actor: CatalogueActor, bookingId: string, rawDate: string): BookingView {
    const { sessionDate } = parseOrThrow(RescheduleInputSchema, { sessionDate: rawDate });
    return this.change(actor, bookingId, "reschedule", (tx, b, now) => {
      if (b.state !== "booked") this.cannot(b);
      const periodStart = this.assertRoom(tx, b.offerId, sessionDate, now, b.id);
      updateBooking(tx, b.id, { sessionDate, periodStart }, now.toISOString());
      return { session_date: sessionDate };
    });
  }

  cancel(actor: CatalogueActor, bookingId: string): BookingView {
    return this.change(actor, bookingId, "cancel", (tx, b, now) => {
      if (b.state !== "booked") this.cannot(b);
      updateBooking(tx, b.id, { state: "cancelled" }, now.toISOString());
      return { state: "cancelled" };
    });
  }

  markHeld(actor: CatalogueActor, bookingId: string): BookingView {
    return this.change(actor, bookingId, "hold", (tx, b, now) => {
      if (b.state !== "booked") this.cannot(b);
      updateBooking(tx, b.id, { state: "held" }, now.toISOString());
      return { state: "held" };
    });
  }

  markNoShow(actor: CatalogueActor, bookingId: string): BookingView {
    return this.change(actor, bookingId, "no_show", (tx, b, now) => {
      if (b.state !== "booked") this.cannot(b);
      updateBooking(tx, b.id, { state: "no_show" }, now.toISOString());
      return { state: "no_show" };
    });
  }

  list(actor: CatalogueActor, offerId: string): BookingView[] {
    return audited(this.db, actor, "offer.read.refused", "engagement_offer", offerId, () => {
      requirePermission(actor, "offers.read");
      return this.db.transaction((tx) => {
        if (!getHead(tx, offerId)) throw new HttpError(404, "Offer not found");
        return listBookings(tx, offerId);
      });
    });
  }

  private cannot(b: BookingRow): never {
    throw new CatalogueRefusal(
      409,
      "Booking cannot change",
      ["invalid_booking_state"],
      [],
      `A session that is ${b.state.replace("_", " ")} cannot be changed. Only a booked session can.`,
    );
  }

  private audit(
    tx: Tx,
    actor: CatalogueActor,
    action: string,
    b: BookingRow,
    after: Record<string, unknown>,
  ): void {
    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: actor.actorType,
        action,
        entityType: "offer_session_booking",
        entityId: b.id,
        outcome: "success",
        after: { offer_id: b.offerId, ...after },
        correlationId: actor.correlationId,
      },
      actor.now,
    );
  }

  private change(
    actor: CatalogueActor,
    bookingId: string,
    op: string,
    apply: (tx: Tx, b: BookingRow, now: Date) => Record<string, unknown>,
  ): BookingView {
    return audited(
      this.db,
      actor,
      `offer.booking.${op}.refused`,
      "offer_session_booking",
      bookingId,
      () => {
        requirePermission(actor, "offers.bookings.edit");
        const now = nowOf(actor);
        return this.db.transaction((tx) => {
          const b = getBooking(tx, bookingId);
          if (!b) throw new HttpError(404, "Booking not found");
          const after = apply(tx, b, now);
          this.audit(tx, actor, `offer.booking.${op}`, b, after);
          return getBooking(tx, bookingId) as BookingRow;
        });
      },
    );
  }
}
