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

// The wait-list for an offer that is full (feature 006, spec FR-015, research R-15). A recorded list for a
// person to review, oldest first. Nothing here contacts anyone and nothing is published as an event.

export const AddInputSchema = z
  .object({
    accountId: z.string().min(1),
    contactId: z.string().min(1).optional(),
    reason: z.string().min(3).max(300),
  })
  .strict();
export const CloseInputSchema = z
  .object({ state: z.enum(["released", "removed"]), reason: z.string().min(3).max(300) })
  .strict();

export interface WaitlistView {
  id: string;
  offerId: string;
  accountId: string;
  contactId: string | null;
  reason: string;
  state: "waiting" | "released" | "removed";
  addedBy: string;
  addedAt: string;
  closedBy: string | null;
  closedAt: string | null;
  closedReason: string | null;
}

interface Row {
  id: string;
  offer_id: string;
  account_id: string;
  contact_id: string | null;
  reason: string;
  state: WaitlistView["state"];
  added_by: string;
  added_at: string;
  closed_by: string | null;
  closed_at: string | null;
  closed_reason: string | null;
}
const toView = (r: Row): WaitlistView => ({
  id: r.id,
  offerId: r.offer_id,
  accountId: r.account_id,
  contactId: r.contact_id,
  reason: r.reason,
  state: r.state,
  addedBy: r.added_by,
  addedAt: r.added_at,
  closedBy: r.closed_by,
  closedAt: r.closed_at,
  closedReason: r.closed_reason,
});

export class WaitlistService {
  constructor(private readonly db: SqliteDatabase) {}

  /** Entries for the offer, oldest first. Waiting ones by default; `all` includes closed entries. */
  list(
    actor: CatalogueActor,
    offerId: string,
    state: "waiting" | "all" = "waiting",
  ): WaitlistView[] {
    return audited(
      this.db,
      actor,
      "offer.waitlist.read.refused",
      "engagement_offer",
      offerId,
      () => {
        requirePermission(actor, "offers.read");
        this.requireOffer(offerId);
        const rows = this.db.raw
          .prepare(
            `SELECT * FROM offer_waitlist_entry WHERE offer_id = ? ${state === "waiting" ? "AND state = 'waiting'" : ""}
           ORDER BY added_at, rowid`,
          )
          .all(offerId) as unknown as Row[];
        return rows.map(toView);
      },
    );
  }

  add(actor: CatalogueActor, offerId: string, raw: unknown): WaitlistView {
    const input = parseOrThrow(AddInputSchema, raw);
    return audited(
      this.db,
      actor,
      "offer.waitlist.add.refused",
      "engagement_offer",
      offerId,
      () => {
        requirePermission(actor, "waitlist.edit");
        guardFreeText({ reason: input.reason });
        this.requireOffer(offerId);
        const id = uuidv7();
        const at = nowOf(actor).toISOString();
        return this.db.transaction((tx) => {
          if (!tx.prepare("SELECT 1 FROM account WHERE id = ?").get(input.accountId)) {
            throw new CatalogueRefusal(404, "Not found", ["unknown_account"]);
          }
          if (
            input.contactId &&
            !tx.prepare("SELECT 1 FROM contact WHERE id = ?").get(input.contactId)
          ) {
            throw new CatalogueRefusal(404, "Not found", ["unknown_contact"]);
          }
          const already = tx
            .prepare(
              "SELECT 1 FROM offer_waitlist_entry WHERE offer_id = ? AND account_id = ? AND COALESCE(contact_id,'') = ? AND state = 'waiting'",
            )
            .get(offerId, input.accountId, input.contactId ?? "");
          if (already)
            throw new CatalogueRefusal(
              409,
              "Conflict",
              ["already_waiting"],
              [],
              "This account is already on the wait-list for this offer.",
            );
          tx.prepare(
            `INSERT INTO offer_waitlist_entry (id, offer_id, account_id, contact_id, reason, added_by, added_at)
           VALUES (?,?,?,?,?,?,?)`,
          ).run(
            id,
            offerId,
            input.accountId,
            input.contactId ?? null,
            input.reason,
            actor.userId as string,
            at,
          );
          recordAudit(
            tx,
            {
              actorId: actor.userId,
              actorType: actor.actorType,
              action: "offer.waitlist.add",
              entityType: "offer_waitlist_entry",
              entityId: id,
              outcome: "success",
              after: { offer_id: offerId },
              correlationId: actor.correlationId,
            },
            actor.now,
          );
          return toView(
            tx.prepare("SELECT * FROM offer_waitlist_entry WHERE id = ?").get(id) as unknown as Row,
          );
        });
      },
    );
  }

  close(actor: CatalogueActor, offerId: string, entryId: string, raw: unknown): WaitlistView {
    const input = parseOrThrow(CloseInputSchema, raw);
    return audited(
      this.db,
      actor,
      "offer.waitlist.close.refused",
      "offer_waitlist_entry",
      entryId,
      () => {
        requirePermission(actor, "waitlist.edit");
        guardFreeText({ reason: input.reason });
        const at = nowOf(actor).toISOString();
        return this.db.transaction((tx) => {
          const row = tx
            .prepare("SELECT * FROM offer_waitlist_entry WHERE id = ? AND offer_id = ?")
            .get(entryId, offerId) as Row | undefined;
          if (!row) throw new CatalogueRefusal(404, "Not found", ["unknown_entry"]);
          if (row.state !== "waiting")
            throw new CatalogueRefusal(
              409,
              "Conflict",
              ["already_closed"],
              [],
              "This entry has already been closed.",
            );
          tx.prepare(
            "UPDATE offer_waitlist_entry SET state = ?, closed_by = ?, closed_at = ?, closed_reason = ? WHERE id = ?",
          ).run(input.state, actor.userId as string, at, input.reason, entryId);
          recordAudit(
            tx,
            {
              actorId: actor.userId,
              actorType: actor.actorType,
              action: "offer.waitlist.close",
              entityType: "offer_waitlist_entry",
              entityId: entryId,
              outcome: "success",
              after: { state: input.state },
              correlationId: actor.correlationId,
            },
            actor.now,
          );
          return toView(
            tx
              .prepare("SELECT * FROM offer_waitlist_entry WHERE id = ?")
              .get(entryId) as unknown as Row,
          );
        });
      },
    );
  }

  private requireOffer(offerId: string): void {
    if (!this.db.raw.prepare("SELECT 1 FROM engagement_offer WHERE id = ?").get(offerId)) {
      throw new CatalogueRefusal(404, "Not found", ["unknown_offer"]);
    }
  }
}
