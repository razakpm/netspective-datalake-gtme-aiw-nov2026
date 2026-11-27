import type { SqliteDatabase } from "@gtm/db";
import { EffortSchema, summariseEffort, type EffortTotals } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { parseOrThrow } from "../../http/errors.js";
import {
  audited,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { offerFacts } from "../offers/index.js";
import { auditChange, workshopOr404 } from "./actor.js";
import { OFFER_1_SLUG, OFFER_6_SLUG } from "./intake.js";
import { effortByOffer, insertEffort, listEffort, type EffortRow } from "./repository.js";

// Delivery effort per workshop and per offer (feature 007, spec FR-033). Append-only: a correction is a new
// entry. The summary sits beside the offer's effort estimate, which is a hypothesis.

export type EffortEntry = Omit<EffortRow, "workshopId">;

export interface OfferEffortSummary extends EffortTotals {
  offerId: string;
  offerKey: string;
  estimate: string | null;
  status: "hypothesis";
}

const entry = (row: EffortRow): EffortEntry => ({
  id: row.id,
  prepHours: row.prepHours,
  sessionHours: row.sessionHours,
  people: row.people,
  recordedBy: row.recordedBy,
  recordedAt: row.recordedAt,
});

export class EffortService {
  constructor(private readonly db: SqliteDatabase) {}

  record(actor: CatalogueActor, workshopId: string, raw: unknown): EffortEntry {
    return audited(this.db, actor, "workshop.effort.record.refused", "workshop", workshopId, () => {
      requirePermission(actor, "workshops.edit");
      const input = parseOrThrow(EffortSchema, raw);
      return this.db.transaction((tx) => {
        workshopOr404(tx, workshopId);
        const row: EffortRow = {
          id: uuidv7(),
          workshopId,
          ...input,
          recordedBy: actor.userId as string,
          recordedAt: nowOf(actor).toISOString(),
        };
        insertEffort(tx, row);
        auditChange(
          tx,
          actor,
          "workshop.effort.record",
          { type: "workshop", id: workshopId },
          { effort_id: row.id },
        );
        return entry(row);
      });
    });
  }

  get(
    actor: CatalogueActor,
    workshopId: string,
  ): { current: EffortEntry | null; history: EffortEntry[] } {
    return audited(this.db, actor, "workshop.read.refused", "workshop", workshopId, () => {
      requirePermission(actor, "workshops.read");
      workshopOr404(this.db.raw, workshopId);
      const history = listEffort(this.db.raw, workshopId).map(entry).reverse();
      return { current: history[0] ?? null, history };
    });
  }

  summary(actor: CatalogueActor): OfferEffortSummary[] {
    return audited(this.db, actor, "workshop.read.refused", "workshop", null, () => {
      requirePermission(actor, "workshops.read");
      const tx = this.db.raw;
      const offers = tx
        .prepare("SELECT id FROM engagement_offer WHERE key IN (?, ?) ORDER BY number")
        .all(OFFER_1_SLUG, OFFER_6_SLUG) as { id: string }[];
      return offers.map(({ id }) => {
        const facts = offerFacts(tx, id)!;
        return {
          offerId: id,
          offerKey: facts.key,
          ...summariseEffort(
            effortByOffer(tx, id).map((w) => ({ state: w.state, effort: w.current })),
          ),
          estimate: facts.effortEstimate,
          status: "hypothesis" as const,
        };
      });
    });
  }
}
