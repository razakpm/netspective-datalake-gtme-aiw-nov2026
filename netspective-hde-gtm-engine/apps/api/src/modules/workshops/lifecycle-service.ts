import type { SqliteDatabase, Tx } from "@gtm/db";
import { checkWorkshopTransition, localDateOf, WORKSHOP_STATES } from "@gtm/domain";
import type { CalendarProvider } from "@gtm/providers";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { parseOrThrow } from "../../http/errors.js";
import {
  audited,
  auditedAsync,
  CatalogueRefusal,
  guardFreeText,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { getAccount } from "../accounts/index.js";
import { checkSuppression, contactById } from "../contacts/index.js";
import { consentWithdrawn, loadRequestForWorkshop } from "../engagement/index.js";
import {
  offerFacts,
  type BookingService,
  type CapacityService,
  type CapacityStatus,
} from "../offers/index.js";
import { auditChange, staleVersion, workshopOr404 } from "./actor.js";
import { emitWorkshopBooked, emitWorkshopHeld, emitWorkshopRequested } from "./events.js";
import {
  hasOpenWorkshop,
  insertHistory,
  insertWorkshop,
  listHistory,
  listParticipants,
  listWorkshops,
  participantView,
  updateWorkshop,
  type HistoryRow,
  type ParticipantView,
  type WorkshopChange,
  type WorkshopRow,
} from "./repository.js";

// Conversion and the lifecycle (feature 007, spec FR-001 to FR-009, research R-02 to R-04). A person asks
// for every move; the pure rules decide whether it is allowed. A booking is a feature 005 booking changed
// in the same transaction, so capacity and state move together. A calendar provider, when used, is asked
// first and outside any transaction. Nothing here sends a message or invites anyone.

export interface LifecycleSettings {
  minutes: { offer1: number; offer6: number };
  businessTimeZone: string;
}

export interface LifecycleDeps {
  bookings: BookingService;
  capacity: CapacityService;
  /** null: no calendar is configured and every booking is made by hand. */
  calendar: CalendarProvider | null;
  settings: LifecycleSettings;
}

export const ConvertSchema = z.object({ requestId: z.string().min(1).max(100) }).strict();
export const TransitionSchema = z
  .object({
    action: z.enum(["book", "reschedule", "hold", "no_show", "cancel", "close"]),
    lockNo: z.number().int().min(1),
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    via: z.enum(["manual", "calendar"]).optional(),
    note: z.string().max(300).optional(),
  })
  .strict();
export const ListFilterSchema = z
  .object({
    offerId: z.string().min(1).max(100).optional(),
    state: z.enum(WORKSHOP_STATES).optional(),
    accountId: z.string().min(1).max(100).optional(),
  })
  .strict();
type Transition = z.infer<typeof TransitionSchema>;

/** Added to a history note when a calendar event could not be removed or moved. */
export const CALENDAR_ATTENTION =
  "(The calendar event needs attention: check it and clear it by hand.)";

export type WorkshopNotice =
  "account_suppressed" | "contact_suppressed" | "consent_withdrawn" | "calendar_needs_attention";

export interface WorkshopSummary {
  id: string;
  offerId: string;
  offerKey: string;
  state: WorkshopRow["state"];
  accountId: string;
  accountName: string;
  contactId: string;
  scheduledAt: string | null;
  durationMinutes: number;
  createdAt: string;
}

export interface WorkshopDetail extends WorkshopSummary {
  requestId: string;
  intakeId: string;
  lockNo: number;
  bookingRoute: WorkshopRow["bookingRoute"];
  bookingId: string | null;
  /** The typed intake payload, non-PHI. */
  intake: Record<string, unknown>;
  history: HistoryRow[];
  participants: ParticipantView[];
  notices: WorkshopNotice[];
  capacity: CapacityStatus;
}

const refuse = (status: number, title: string, code: string, detail: string) =>
  new CatalogueRefusal(status, title, [code], [], detail);

const ROLLBACK = Symbol("rollback");

const TRANSITION_PROBLEMS = {
  invalid_transition: [409, "That move is not allowed"],
  note_required: [400, "A reason is needed"],
  time_required: [400, "A date and time are needed"],
} as const;

export class WorkshopService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly d: LifecycleDeps,
  ) {}

  convert(actor: CatalogueActor, requestId: string): WorkshopDetail {
    return audited(this.db, actor, "workshop.convert.refused", "offer_request", requestId, () => {
      requirePermission(actor, "workshops.edit");
      const at = nowOf(actor).toISOString();
      const id = this.db.transaction((tx) => {
        const source = loadRequestForWorkshop(tx, requestId);
        if (!source) throw refuse(404, "Not found", "unknown_request", "No such request.");
        const kind = source.intake?.kind;
        if (source.kind !== "intake" || !source.intake || !kind) {
          throw refuse(
            409,
            "Not a workshop request",
            "offer_not_supported",
            "Only an Offer 1 or Offer 6 intake can become a workshop.",
          );
        }
        if (source.state !== "linked" || !source.accountId || !source.contactId) {
          throw refuse(
            409,
            "Request not linked",
            "request_not_linked",
            "Review the request and link it to an account and contact first.",
          );
        }
        const open = () =>
          refuse(
            409,
            "A workshop already exists",
            "workshop_open",
            "This request already has an open workshop.",
          );
        if (hasOpenWorkshop(tx, requestId)) throw open();
        const workshop: WorkshopRow = {
          id: uuidv7(),
          requestId,
          offerId: source.offerId,
          intakeId: source.intake.id,
          accountId: source.accountId,
          contactId: source.contactId,
          state: "requested",
          durationMinutes:
            kind === "offer_1" ? this.d.settings.minutes.offer1 : this.d.settings.minutes.offer6,
          scheduledAt: null,
          sessionDate: null,
          bookingId: null,
          bookingRoute: null,
          calendarRef: null,
          lockNo: 1,
          createdBy: actor.userId as string,
          createdAt: at,
          updatedAt: at,
          closedAt: null,
        };
        try {
          insertWorkshop(tx, workshop);
        } catch (error) {
          if (String(error).includes("UNIQUE")) throw open();
          throw error;
        }
        this.history(tx, actor, workshop.id, {
          fromState: null,
          toState: "requested",
          note: null,
          scheduledFrom: null,
          scheduledTo: null,
        });
        auditChange(
          tx,
          actor,
          "workshop.convert",
          { type: "workshop", id: workshop.id },
          { request_id: requestId, offer_id: workshop.offerId, to_state: "requested" },
        );
        emitWorkshopRequested(tx, actor, {
          workshopId: workshop.id,
          offerId: workshop.offerId,
          requestId,
        });
        return workshop.id;
      });
      return this.detail(id, nowOf(actor));
    });
  }

  list(actor: CatalogueActor, rawFilter: unknown = {}): WorkshopSummary[] {
    const filter = parseOrThrow(ListFilterSchema, rawFilter);
    return audited(this.db, actor, "workshop.read.refused", "workshop", null, () => {
      requirePermission(actor, "workshops.read");
      return listWorkshops(this.db.raw, filter.state)
        .filter((w) => filter.offerId === undefined || w.offerId === filter.offerId)
        .filter((w) => filter.accountId === undefined || w.accountId === filter.accountId)
        .map((w) => this.summary(this.db.raw, w));
    });
  }

  get(actor: CatalogueActor, id: string): WorkshopDetail {
    return audited(this.db, actor, "workshop.read.refused", "workshop", id, () => {
      requirePermission(actor, "workshops.read");
      return this.detail(id, nowOf(actor));
    });
  }

  async transition(actor: CatalogueActor, id: string, raw: unknown): Promise<WorkshopDetail> {
    const input = parseOrThrow(TransitionSchema, raw);
    return auditedAsync(
      this.db,
      actor,
      `workshop.${input.action}.refused`,
      "workshop",
      id,
      async () => {
        requirePermission(actor, "workshops.edit");
        const workshop = workshopOr404(this.db.raw, id);
        if (workshop.lockNo !== input.lockNo) throw staleVersion();
        const note = input.note?.trim() || undefined;
        const check = checkWorkshopTransition(workshop.state, input.action, {
          note,
          scheduledAt: input.scheduledAt,
        });
        if (!check.ok) {
          const [status, title] = TRANSITION_PROBLEMS[check.code];
          throw refuse(status, title, check.code, `${title}.`);
        }
        if (note) guardFreeText({ note });
        if (input.action === "book" || input.action === "reschedule") {
          this.requireBookableOffer(workshop.offerId);
        }
        const calendar = await this.askCalendar(actor, workshop, input);
        try {
          this.db.transaction((tx) => this.apply(tx, actor, workshop, input, note, calendar));
        } catch (error) {
          // Nothing was recorded, so an event made for this move must not stay in the calendar.
          if (calendar.created) await this.d.calendar?.cancelEvent(calendar.created);
          throw error;
        }
        return this.detail(id, nowOf(actor));
      },
    );
  }

  // ---- booking ------------------------------------------------------------------------------------

  private requireBookableOffer(offerId: string): void {
    const status = offerFacts(this.db.raw, offerId)?.status;
    if (status !== "approved" && status !== "available") {
      throw refuse(
        409,
        "Offer not available",
        "offer_unavailable",
        `The offer is ${(status ?? "unknown").replace("_", " ")}, so no session can be booked.`,
      );
    }
  }

  private sessionDate(scheduledAt: string): string {
    return localDateOf(new Date(scheduledAt), this.d.settings.businessTimeZone);
  }

  /** Move the feature 005 booking; used for the real change and, rolled back, to check capacity. */
  private moveBooking(
    tx: Tx,
    actor: CatalogueActor,
    workshop: WorkshopRow,
    scheduledAt: string,
  ): string {
    const sessionDate = this.sessionDate(scheduledAt);
    try {
      if (workshop.bookingId) {
        this.d.bookings.rescheduleIn(tx, actor, workshop.bookingId, sessionDate);
        return workshop.bookingId;
      }
      return this.d.bookings.recordIn(tx, actor, workshop.offerId, { sessionDate }).id;
    } catch (error) {
      if (!(error instanceof CatalogueRefusal) || !error.codes.includes("capacity_exhausted")) {
        throw error;
      }
      // A person's next step: the wait-list and the other alternatives of feature 006.
      throw new CatalogueRefusal(
        error.status,
        error.title,
        error.codes,
        [],
        `${error.detail} You can add the account to this offer's wait-list instead.`,
      );
    }
  }

  /** Refuse a full period before the calendar is touched: the move is tried and rolled back. */
  private assertCapacity(actor: CatalogueActor, workshop: WorkshopRow, scheduledAt: string): void {
    try {
      this.db.transaction((tx) => {
        this.moveBooking(tx, actor, workshop, scheduledAt);
        throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  }

  /**
   * Make, move or remove the calendar event for this move. A failure while booking refuses the booking; a
   * failure while cancelling or rescheduling is reported and the booking still changes, because capacity
   * must not be held by an event a person cannot remove.
   */
  private async askCalendar(
    actor: CatalogueActor,
    workshop: WorkshopRow,
    input: Transition,
  ): Promise<CalendarOutcome> {
    const outcome: CalendarOutcome = {
      route: workshop.bookingRoute,
      ref: workshop.calendarRef,
      created: null,
      attention: false,
    };
    const { action, scheduledAt } = input;
    if (action !== "book" && action !== "reschedule" && action !== "cancel") return outcome;
    const via = action === "cancel" ? null : (input.via ?? workshop.bookingRoute ?? "manual");
    if (via !== null) outcome.route = via;
    if (via === "calendar" && !this.d.calendar && action === "book") {
      throw refuse(
        409,
        "No calendar",
        "calendar_failed",
        "No calendar is configured. Book by hand.",
      );
    }
    if (scheduledAt && (via === "calendar" || workshop.calendarRef)) {
      this.assertCapacity(actor, workshop, scheduledAt);
    }
    if (workshop.calendarRef) {
      const removed = await this.d.calendar?.cancelEvent(workshop.calendarRef, actor.correlationId);
      if (removed?.ok) outcome.ref = null;
      else outcome.attention = true;
    }
    if (via !== "calendar" || !scheduledAt) return outcome;
    const made = await this.d.calendar?.createEvent({
      title: `Workshop: ${offerFacts(this.db.raw, workshop.offerId)?.name ?? workshop.offerId}`,
      start: new Date(scheduledAt).toISOString(),
      durationMinutes: workshop.durationMinutes,
      attendeeLabels: listParticipants(this.db.raw, workshop.id)
        .filter((p) => p.removedAt === null)
        .map((p) => p.displayName),
      correlationId: actor.correlationId,
    });
    if (made?.ok) {
      outcome.ref = made.value.ref;
      outcome.created = made.value.ref;
      return outcome;
    }
    if (action === "book") {
      const busy = made?.error.code === "conflict";
      throw refuse(
        busy ? 409 : 502,
        busy ? "The calendar is busy then" : "The calendar did not answer",
        "calendar_failed",
        busy
          ? "The calendar shows that time as busy. Choose another time or book by hand."
          : "The calendar event could not be made. Nothing was booked; you can book by hand.",
      );
    }
    outcome.attention = true;
    outcome.route = "manual";
    return outcome;
  }

  // ---- the change ---------------------------------------------------------------------------------

  private apply(
    tx: Tx,
    actor: CatalogueActor,
    before: WorkshopRow,
    input: Transition,
    note: string | undefined,
    calendar: CalendarOutcome,
  ): void {
    const now = nowOf(actor).toISOString();
    const at = input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null;
    const change: Partial<WorkshopChange> = {};
    const subject = { workshopId: before.id, offerId: before.offerId };
    switch (input.action) {
      case "book":
      case "reschedule": {
        const when = at as string;
        change.bookingId = this.moveBooking(tx, actor, before, when);
        change.state = "booked";
        change.scheduledAt = when;
        change.sessionDate = this.sessionDate(when);
        change.bookingRoute = calendar.route ?? "manual";
        change.calendarRef = calendar.ref;
        emitWorkshopBooked(tx, actor, { ...subject, reschedule: input.action === "reschedule" });
        break;
      }
      case "hold":
        this.d.bookings.holdIn(tx, actor, before.bookingId as string);
        change.state = "held";
        emitWorkshopHeld(tx, actor, subject);
        break;
      case "no_show":
        this.d.bookings.noShowIn(tx, actor, before.bookingId as string);
        change.state = "no_show";
        change.closedAt = now;
        break;
      case "cancel":
        if (before.bookingId) this.d.bookings.cancelIn(tx, actor, before.bookingId);
        change.state = "cancelled";
        change.calendarRef = calendar.ref;
        change.closedAt = now;
        break;
      case "close":
        change.state = "closed";
        change.closedAt = now;
        break;
    }
    if (!updateWorkshop(tx, before.id, change, input.lockNo, now)) throw staleVersion();
    const to = change.state as WorkshopRow["state"];
    const moved = input.action === "book" || input.action === "reschedule";
    this.history(tx, actor, before.id, {
      fromState: before.state,
      toState: to,
      note: calendar.attention
        ? [note, CALENDAR_ATTENTION].filter(Boolean).join(" ")
        : (note ?? null),
      scheduledFrom: moved ? before.scheduledAt : null,
      scheduledTo: moved ? at : null,
    });
    // The reason is in the history row; the audit record names it, never repeats it.
    auditChange(
      tx,
      actor,
      `workshop.${input.action}`,
      { type: "workshop", id: before.id },
      {
        from_state: before.state,
        to_state: to,
        reason_recorded: note !== undefined,
        ...(moved ? { route: change.bookingRoute, session_date: change.sessionDate } : {}),
        ...(calendar.attention ? { calendar_needs_attention: true } : {}),
      },
    );
  }

  private history(
    tx: Tx,
    actor: CatalogueActor,
    workshopId: string,
    row: Omit<HistoryRow, "id" | "changedBy" | "changedAt">,
  ): void {
    insertHistory(tx, workshopId, {
      ...row,
      id: uuidv7(),
      changedBy: actor.userId as string,
      changedAt: nowOf(actor).toISOString(),
    });
  }

  // ---- reading ------------------------------------------------------------------------------------

  private summary(tx: Tx, w: WorkshopRow): WorkshopSummary {
    return {
      id: w.id,
      offerId: w.offerId,
      offerKey: offerFacts(tx, w.offerId)?.key ?? w.offerId,
      state: w.state,
      accountId: w.accountId,
      accountName: getAccount(tx, w.accountId)?.name ?? "",
      contactId: w.contactId,
      scheduledAt: w.scheduledAt,
      durationMinutes: w.durationMinutes,
      createdAt: w.createdAt,
    };
  }

  private detail(id: string, now: Date): WorkshopDetail {
    const tx = this.db.raw;
    const w = workshopOr404(tx, id);
    const history = listHistory(tx, id);
    const source = loadRequestForWorkshop(tx, w.requestId);
    return {
      ...this.summary(tx, w),
      requestId: w.requestId,
      intakeId: w.intakeId,
      lockNo: w.lockNo,
      bookingRoute: w.bookingRoute,
      bookingId: w.bookingId,
      intake: (source?.intake?.payload ?? {}) as Record<string, unknown>,
      history,
      participants: listParticipants(tx, id).map(participantView),
      notices: this.notices(tx, w, history),
      capacity: this.d.capacity.capacityStatus(
        w.offerId,
        w.scheduledAt ? new Date(w.scheduledAt) : now,
      ),
    };
  }

  /** What an operator must know before contacting anyone. Nothing here contacts anyone. */
  private notices(tx: Tx, w: WorkshopRow, history: HistoryRow[]): WorkshopNotice[] {
    const notices: WorkshopNotice[] = [];
    if (checkSuppression(tx, { accountId: w.accountId }).suppressed) {
      notices.push("account_suppressed");
    }
    const emailHash = contactById(tx, w.contactId)?.emailHash ?? null;
    if (checkSuppression(tx, { contactId: w.contactId, emailHash }).suppressed) {
      notices.push("contact_suppressed");
    }
    if (consentWithdrawn(tx, { contactId: w.contactId, emailHash })) {
      notices.push("consent_withdrawn");
    }
    if (history.some((h) => h.note?.includes(CALENDAR_ATTENTION))) {
      notices.push("calendar_needs_attention");
    }
    return notices;
  }
}

interface CalendarOutcome {
  route: WorkshopRow["bookingRoute"];
  ref: string | null;
  /** An event made for this move, to be removed if the move is not recorded. */
  created: string | null;
  attention: boolean;
}
