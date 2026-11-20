import type { SqliteDatabase } from "@gtm/db";
import {
  checkOfferTransition,
  evaluateOfferGate,
  PUBLIC_OFFER_FIELDS,
  type GateRefusal,
  type OfferStatus,
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
import { checkText } from "../claims/index.js";
import { ctxOf, emitOfferUpdated } from "./events.js";
import { limitationViews, parseSnapshot, versionView, type VersionView } from "./queries.js";
import {
  getHead,
  getVersionRow,
  insertStatus,
  isSuperseded,
  latestStatus,
  setInForce,
  type VersionRow,
} from "./repository.js";

// Status moves for an offer version (feature 005, task T034): the pure transition check, the gate with
// its inputs gathered here, the in-force pointer and the audit and event, all in one transaction.

export const MoveInputSchema = z
  .object({
    to: z.enum(["draft", "internally_reviewed", "approved", "available", "withdrawn", "expired"]),
    note: z.string().min(1).max(300).optional(),
  })
  .strict();

function describeRefusals(refusals: readonly GateRefusal[]): string {
  return refusals
    .map((r) => {
      switch (r.code) {
        case "placeholder_attributes":
          return `Attributes are still to be provided: ${r.fields.join(", ")}`;
        case "limitation_unacknowledged":
          return `A limitation is not acknowledged: ${r.limitations.join(", ")}`;
        case "uncovered_restricted_phrase":
          return `Restricted wording is not covered by an approved claim: ${r.flags
            .map((f) => `${f.field} (${f.rule})`)
            .join(", ")}`;
      }
    })
    .join("; ");
}

export class OfferStatusService {
  constructor(readonly db: SqliteDatabase) {}

  moveStatus(
    actor: CatalogueActor,
    offerId: string,
    versionNo: number,
    to: OfferStatus,
    note?: string,
  ): VersionView {
    const input = parseOrThrow(MoveInputSchema, { to, ...(note === undefined ? {} : { note }) });
    return audited(this.db, actor, "offer.status.move.refused", "engagement_offer", offerId, () => {
      requirePermission(actor, "offers.status.change");
      if (input.note) guardFreeText({ note: input.note });
      const now = nowOf(actor);
      const at = now.toISOString();
      return this.db.transaction((tx) => {
        const head = getHead(tx, offerId);
        const row = head ? getVersionRow(tx, offerId, versionNo) : null;
        if (!head || !row)
          throw new CatalogueRefusal(404, "Offer version not found", ["not_found"]);
        if (isSuperseded(tx, offerId, versionNo)) {
          throw new CatalogueRefusal(
            409,
            "Version superseded",
            ["version_superseded"],
            [],
            "A later version has been approved, so this version can no longer change status.",
          );
        }
        const from = latestStatus(tx, offerId, versionNo).status;
        const check = checkOfferTransition(from, input.to);
        if (!check.ok) {
          throw new CatalogueRefusal(409, "Status move refused", [check.code], [], check.reason);
        }
        const refusals = evaluateOfferGate({
          to: input.to,
          snapshot: parseSnapshot(row),
          limitations: limitationViews(tx, offerId).map((l) => ({
            key: l.key,
            active: l.active,
            acknowledged: l.acknowledged,
          })),
          flags: this.flags(tx, row, at),
        });
        if (refusals.length > 0) {
          throw new CatalogueRefusal(
            409,
            "Offer version cannot move",
            refusals.map((r) => r.code),
            [],
            `This version cannot move to ${input.to.replace("_", " ")}. ${describeRefusals(refusals)}.`,
          );
        }
        insertStatus(tx, {
          id: uuidv7(),
          offerId,
          versionNo,
          status: input.to,
          changedBy: actor.userId as string,
          note: input.note ?? null,
          changedAt: at,
        });
        if (input.to === "approved") setInForce(tx, offerId, versionNo);
        else if (
          (input.to === "withdrawn" || input.to === "expired") &&
          head.inForceVersionNo === versionNo
        ) {
          setInForce(tx, offerId, null);
        }
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "offer.status.move",
            entityType: "engagement_offer",
            entityId: offerId,
            outcome: "success",
            before: { version_no: versionNo, status: from },
            after: { version_no: versionNo, status: input.to },
            correlationId: actor.correlationId,
          },
          actor.now,
        );
        emitOfferUpdated(tx, ctxOf(actor), {
          offerId,
          versionNo,
          change: "status",
          status: input.to,
        });
        return versionView(tx, getVersionRow(tx, offerId, versionNo) as VersionRow);
      });
    });
  }

  /** The checker's flags in the public fields of a version, each marked covered or not. */
  private flags(
    tx: Parameters<Parameters<SqliteDatabase["transaction"]>[0]>[0],
    row: VersionRow,
    at: string,
  ) {
    const snapshot = parseSnapshot(row);
    return PUBLIC_OFFER_FIELDS.flatMap((field) => {
      const text = snapshot[field];
      if (!text) return [];
      return checkText(tx, text, at).matches.map((m) => ({
        field,
        rule: m.rule,
        class: m.class,
        covered: m.covered,
      }));
    });
  }
}
