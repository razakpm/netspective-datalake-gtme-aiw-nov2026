import type { SqliteDatabase, Tx } from "@gtm/db";
import { snapshotHash } from "@gtm/db";
import { OfferPatchSchema, OfferSnapshotSchema, type OfferSnapshot } from "@gtm/domain";
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
import {
  limitationViews,
  offerSummary,
  parseSnapshot,
  versionView,
  type LimitationView,
  type OfferSummary,
  type VersionView,
} from "./queries.js";
import {
  bumpHead,
  getHead,
  getVersionRow,
  insertStatus,
  insertVersion,
  listHeads,
  listVersionRows,
  type OfferHead,
  type VersionRow,
} from "./repository.js";
import { v7 as uuidv7 } from "uuid";

// Offers: the catalogue, versions and their creation (feature 005, tasks T032 and T033). Status moves
// are in status.ts and limitations in limitations.ts. Everything is audited in the same transaction.

export const VersionInputSchema = z
  .object({ patch: OfferPatchSchema, reason: z.string().min(3).max(300) })
  .strict();

export interface OfferDetail extends OfferSummary {
  latest: VersionView;
  inForce: VersionView | null;
  limitations: LimitationView[];
}

export class OfferService {
  constructor(readonly db: SqliteDatabase) {}

  private head(tx: Tx, id: string): OfferHead {
    const head = getHead(tx, id);
    if (!head) throw new CatalogueRefusal(404, "Offer not found", ["not_found"]);
    return head;
  }

  list(actor: CatalogueActor): OfferSummary[] {
    return audited(this.db, actor, "offer.read.refused", "engagement_offer", null, () => {
      requirePermission(actor, "offers.read");
      return this.db.transaction((tx) =>
        listHeads(tx).map((h) => offerSummary(tx, h, nowOf(actor).toISOString())),
      );
    });
  }

  get(actor: CatalogueActor, offerId: string): OfferDetail {
    return audited(this.db, actor, "offer.read.refused", "engagement_offer", offerId, () => {
      requirePermission(actor, "offers.read");
      return this.db.transaction((tx) => {
        const head = this.head(tx, offerId);
        const inForce =
          head.inForceVersionNo === null ? null : getVersionRow(tx, offerId, head.inForceVersionNo);
        return {
          ...offerSummary(tx, head, nowOf(actor).toISOString()),
          latest: versionView(tx, getVersionRow(tx, offerId, head.latestVersionNo) as VersionRow),
          inForce: inForce ? versionView(tx, inForce) : null,
          limitations: limitationViews(tx, offerId),
        };
      });
    });
  }

  listVersions(actor: CatalogueActor, offerId: string): VersionView[] {
    return audited(this.db, actor, "offer.read.refused", "engagement_offer", offerId, () => {
      requirePermission(actor, "offers.read");
      return this.db.transaction((tx) => {
        this.head(tx, offerId);
        return listVersionRows(tx, offerId).map((v) => versionView(tx, v));
      });
    });
  }

  getVersion(actor: CatalogueActor, offerId: string, versionNo: number): VersionView {
    return audited(this.db, actor, "offer.read.refused", "engagement_offer", offerId, () => {
      requirePermission(actor, "offers.read");
      return this.db.transaction((tx) => {
        this.head(tx, offerId);
        const row = getVersionRow(tx, offerId, versionNo);
        if (!row) throw new CatalogueRefusal(404, "Offer version not found", ["not_found"]);
        return versionView(tx, row);
      });
    });
  }

  /** A change always creates a new immutable version at draft; the approved version stays in force. */
  createVersion(
    actor: CatalogueActor,
    offerId: string,
    raw: unknown,
    expectedVersion: number,
  ): VersionView {
    const input = parseOrThrow(VersionInputSchema, raw);
    return audited(
      this.db,
      actor,
      "offer.version.create.refused",
      "engagement_offer",
      offerId,
      () => {
        requirePermission(actor, "offers.edit");
        guardFreeText({ patch: input.patch, reason: input.reason });
        const at = nowOf(actor).toISOString();
        return this.db.transaction((tx) => {
          const head = this.head(tx, offerId);
          const latest = getVersionRow(tx, offerId, head.latestVersionNo) as VersionRow;
          const base = parseSnapshot(latest);
          const { effortEstimate, ...content } = input.patch;
          const merged: OfferSnapshot = OfferSnapshotSchema.parse({
            ...base,
            ...Object.fromEntries(Object.entries(content).filter(([, v]) => v !== undefined)),
            effortEstimate: effortEstimate
              ? { text: effortEstimate.text, status: "hypothesis" }
              : base.effortEstimate,
          });
          const hash = snapshotHash(merged);
          if (hash === latest.snapshotHash) {
            throw new CatalogueRefusal(
              409,
              "Nothing changed",
              ["no_changes"],
              [],
              "The change does not alter the latest version.",
            );
          }
          const versionNo = head.latestVersionNo + 1;
          if (!bumpHead(tx, offerId, expectedVersion, versionNo)) {
            throw new CatalogueRefusal(
              409,
              "Stale version",
              ["stale_version"],
              [],
              "The offer changed. Reload and try again.",
            );
          }
          insertVersion(tx, {
            offerId,
            versionNo,
            snapshotJson: JSON.stringify(merged),
            snapshotHash: hash,
            reason: input.reason,
            createdBy: actor.userId as string,
            createdAt: at,
          });
          insertStatus(tx, {
            id: uuidv7(),
            offerId,
            versionNo,
            status: "draft",
            changedBy: actor.userId as string,
            note: null,
            changedAt: at,
          });
          recordAudit(
            tx,
            {
              actorId: actor.userId,
              actorType: actor.actorType,
              action: "offer.version.create",
              entityType: "engagement_offer",
              entityId: offerId,
              outcome: "success",
              after: { version_no: versionNo, snapshot_hash: hash },
              correlationId: actor.correlationId,
            },
            actor.now,
          );
          emitOfferUpdated(tx, ctxOf(actor), {
            offerId,
            versionNo,
            change: "version",
            status: "draft",
          });
          return versionView(tx, getVersionRow(tx, offerId, versionNo) as VersionRow);
        });
      },
    );
  }
}
