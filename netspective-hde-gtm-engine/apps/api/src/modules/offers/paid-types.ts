import type { SqliteDatabase, Tx } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { HttpError, parseOrThrow } from "../../http/errors.js";
import {
  audited,
  CatalogueRefusal,
  guardFreeText,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { recordAudit } from "../audit/index.js";

// Paid engagement types and the deliverables that are not in the source (feature 005, task T047).
// There is no price, fee, rate or currency anywhere: the request schemas are strict, so such a key is
// rejected as unknown. A new deliverable starts pending and is usable only once approved.

type Row = Record<string, unknown>;

export const PaidTypeChangeSchema = z
  .object({
    lockNo: z.number().int().min(1),
    scope: z.array(z.string().min(1).max(300)).max(20).optional(),
    weeksMin: z.number().int().min(1).max(104).nullable().optional(),
    weeksMax: z.number().int().min(1).max(104).nullable().optional(),
    status: z.enum(["active", "inactive"]).optional(),
    scopeConfirmed: z.boolean().optional(),
  })
  .strict();
export const DeliverableInputSchema = z.object({ text: z.string().min(3).max(300) }).strict();
export const DeliverableDecisionSchema = z
  .object({ decision: z.enum(["approve", "reject"]), note: z.string().min(3).max(500) })
  .strict();

export interface DeliverableView {
  id: string;
  text: string;
  inSource: boolean;
  approval: "approved" | "pending_approval" | "rejected";
  approvedBy: string | null;
  decidedAt: string | null;
}
export interface PaidTypeView {
  key: string;
  name: string;
  weeksMin: number | null;
  weeksMax: number | null;
  scope: string[];
  scopeConfirmed: boolean;
  status: "active" | "inactive";
  lockNo: number;
  deliverables: DeliverableView[];
}

const deliverable = (r: Row): DeliverableView => ({
  id: r["id"] as string,
  text: r["text"] as string,
  inSource: r["in_source"] === 1,
  approval: r["approval"] as DeliverableView["approval"],
  approvedBy: r["approved_by"] as string | null,
  decidedAt: r["decided_at"] as string | null,
});

export class PaidTypeService {
  constructor(readonly db: SqliteDatabase) {}

  private view(tx: Tx, key: string): PaidTypeView {
    const r = tx.prepare("SELECT * FROM paid_engagement_type WHERE key = ?").get(key) as
      Row | undefined;
    if (!r) throw new CatalogueRefusal(404, "Paid engagement type not found", ["not_found"]);
    return {
      key,
      name: r["name"] as string,
      weeksMin: r["weeks_min"] as number | null,
      weeksMax: r["weeks_max"] as number | null,
      scope: JSON.parse(r["scope_json"] as string) as string[],
      scopeConfirmed: r["scope_confirmed"] === 1,
      status: r["status"] as "active" | "inactive",
      lockNo: r["lock_no"] as number,
      deliverables: (
        tx
          .prepare(
            "SELECT * FROM paid_engagement_deliverable WHERE type_key = ? ORDER BY in_source DESC, text",
          )
          .all(key) as Row[]
      ).map(deliverable),
    };
  }

  list(actor: CatalogueActor): PaidTypeView[] {
    return audited(this.db, actor, "paid_type.read.refused", "paid_engagement_type", null, () => {
      requirePermission(actor, "offers.read");
      return this.db.transaction((tx) =>
        (tx.prepare("SELECT key FROM paid_engagement_type ORDER BY key").all() as Row[]).map((r) =>
          this.view(tx, r["key"] as string),
        ),
      );
    });
  }

  /** Approved deliverables only: what scoping (feature 008) may use. */
  usableDeliverables(key: string): DeliverableView[] {
    return this.db.transaction((tx) =>
      this.view(tx, key).deliverables.filter((d) => d.approval === "approved"),
    );
  }

  update(actor: CatalogueActor, key: string, raw: unknown): PaidTypeView {
    const input = parseOrThrow(PaidTypeChangeSchema, raw);
    return audited(this.db, actor, "paid_type.edit.refused", "paid_engagement_type", key, () => {
      requirePermission(actor, "paid_types.edit");
      if (input.scope) guardFreeText({ scope: input.scope });
      return this.db.transaction((tx) => {
        const current = this.view(tx, key);
        const min = input.weeksMin === undefined ? current.weeksMin : input.weeksMin;
        const max = input.weeksMax === undefined ? current.weeksMax : input.weeksMax;
        if (min !== null && max !== null && min > max) {
          throw new CatalogueRefusal(
            400,
            "Invalid weeks",
            ["invalid_weeks"],
            [],
            "The minimum weeks cannot be greater than the maximum weeks.",
          );
        }
        const res = tx
          .prepare(
            "UPDATE paid_engagement_type SET scope_json = ?, weeks_min = ?, weeks_max = ?, status = ?, scope_confirmed = ?, lock_no = lock_no + 1 WHERE key = ? AND lock_no = ?",
          )
          .run(
            JSON.stringify(input.scope ?? current.scope),
            min,
            max,
            input.status ?? current.status,
            (input.scopeConfirmed ?? current.scopeConfirmed) ? 1 : 0,
            key,
            input.lockNo,
          );
        if (Number(res.changes) !== 1) {
          throw new CatalogueRefusal(
            409,
            "Stale version",
            ["stale_version"],
            [],
            "The paid engagement type changed. Reload and try again.",
          );
        }
        this.audit(tx, actor, "paid_type.edit", key, {
          changed: Object.keys(input).filter((k) => k !== "lockNo"),
        });
        return this.view(tx, key);
      });
    });
  }

  proposeDeliverable(actor: CatalogueActor, key: string, raw: unknown): PaidTypeView {
    const input = parseOrThrow(DeliverableInputSchema, raw);
    return audited(
      this.db,
      actor,
      "paid_type.deliverable.propose.refused",
      "paid_engagement_type",
      key,
      () => {
        requirePermission(actor, "paid_types.edit");
        guardFreeText({ text: input.text });
        return this.db.transaction((tx) => {
          this.view(tx, key);
          const id = uuidv7();
          tx.prepare(
            "INSERT INTO paid_engagement_deliverable (id, type_key, text, in_source, approval, approved_by, decided_at) VALUES (?,?,?,0,'pending_approval',NULL,NULL)",
          ).run(id, key, input.text);
          this.audit(tx, actor, "paid_type.deliverable.propose", id, { type_key: key });
          return this.view(tx, key);
        });
      },
    );
  }

  decideDeliverable(
    actor: CatalogueActor,
    key: string,
    deliverableId: string,
    raw: unknown,
  ): PaidTypeView {
    const input = parseOrThrow(DeliverableDecisionSchema, raw);
    return audited(
      this.db,
      actor,
      "paid_type.deliverable.decide.refused",
      "paid_engagement_type",
      key,
      () => {
        requirePermission(actor, "paid_types.approve");
        guardFreeText({ note: input.note });
        const at = nowOf(actor).toISOString();
        return this.db.transaction((tx) => {
          this.view(tx, key);
          const d = tx
            .prepare("SELECT * FROM paid_engagement_deliverable WHERE id = ? AND type_key = ?")
            .get(deliverableId, key) as Row | undefined;
          if (!d) throw new HttpError(404, "Deliverable not found");
          if (d["approval"] !== "pending_approval") {
            throw new CatalogueRefusal(
              409,
              "Deliverable already decided",
              ["already_decided"],
              [],
              d["in_source"] === 1
                ? "This deliverable is in the source material and is already approved."
                : `This deliverable is already ${String(d["approval"]).replace("_", " ")}.`,
            );
          }
          tx.prepare(
            "UPDATE paid_engagement_deliverable SET approval = ?, approved_by = ?, decided_at = ? WHERE id = ?",
          ).run(
            input.decision === "approve" ? "approved" : "rejected",
            actor.userId,
            at,
            deliverableId,
          );
          this.audit(tx, actor, "paid_type.deliverable.decide", deliverableId, {
            type_key: key,
            decision: input.decision,
            note: input.note,
          });
          return this.view(tx, key);
        });
      },
    );
  }

  private audit(
    tx: Tx,
    actor: CatalogueActor,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
  ): void {
    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: actor.actorType,
        action,
        entityType: "paid_engagement_type",
        entityId,
        outcome: "success",
        after,
        correlationId: actor.correlationId,
      },
      actor.now,
    );
  }
}
