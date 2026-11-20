import type { SqliteDatabase } from "@gtm/db";
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
import { ctxOf, emitOfferUpdated } from "./events.js";
import { getHead, latestStatus } from "./repository.js";

// Offer scores (feature 005, task T047): judgements labelled hypothesis, append-only, on a configured
// scale. The criteria come from the business source, which is not in the repository, so none are seeded.

type Row = Record<string, unknown>;

export const CriterionInputSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{2,60}$/),
    label: z.string().min(2).max(120),
    position: z.number().int().min(0).max(99),
  })
  .strict();
export const ScoreInputSchema = z
  .object({
    offerId: z.string().min(1).max(100),
    criterionKey: z.string().min(1).max(60),
    score: z.number().int(),
    rationale: z.string().min(3).max(500).optional(),
  })
  .strict();

export interface ScoreSettings {
  scoreMin: number;
  scoreMax: number;
}
export interface ScoreView {
  offerId: string;
  criterionKey: string;
  score: number;
  status: "hypothesis";
  rationale: string | null;
  setBy: string;
  setAt: string;
}
const score = (r: Row): ScoreView => ({
  offerId: r["offer_id"] as string,
  criterionKey: r["criterion_key"] as string,
  score: r["score"] as number,
  status: "hypothesis",
  rationale: r["rationale"] as string | null,
  setBy: r["set_by"] as string,
  setAt: r["set_at"] as string,
});

export class ScoreService {
  constructor(
    readonly db: SqliteDatabase,
    readonly settings: ScoreSettings,
  ) {}

  list(actor: CatalogueActor): {
    criteria: { key: string; label: string; position: number }[];
    scores: ScoreView[];
  } {
    return audited(this.db, actor, "offer.read.refused", "offer_score", null, () => {
      requirePermission(actor, "offers.read");
      return this.db.transaction((tx) => ({
        criteria: (
          tx.prepare("SELECT * FROM offer_score_criterion ORDER BY position, key").all() as Row[]
        ).map((r) => ({
          key: r["key"] as string,
          label: r["label"] as string,
          position: r["position"] as number,
        })),
        scores: (
          tx
            .prepare(
              "SELECT s.* FROM offer_score s WHERE s.rowid = (SELECT s2.rowid FROM offer_score s2 WHERE s2.offer_id = s.offer_id AND s2.criterion_key = s.criterion_key ORDER BY s2.set_at DESC, s2.rowid DESC LIMIT 1) ORDER BY s.offer_id, s.criterion_key",
            )
            .all() as Row[]
        ).map(score),
      }));
    });
  }

  history(actor: CatalogueActor, offerId: string, criterionKey: string): ScoreView[] {
    return audited(this.db, actor, "offer.read.refused", "offer_score", offerId, () => {
      requirePermission(actor, "offers.read");
      return this.db.transaction((tx) =>
        (
          tx
            .prepare(
              "SELECT * FROM offer_score WHERE offer_id = ? AND criterion_key = ? ORDER BY set_at, rowid",
            )
            .all(offerId, criterionKey) as Row[]
        ).map(score),
      );
    });
  }

  addCriterion(actor: CatalogueActor, raw: unknown): void {
    const input = parseOrThrow(CriterionInputSchema, raw);
    audited(
      this.db,
      actor,
      "offer.criterion.add.refused",
      "offer_score_criterion",
      input.key,
      () => {
        requirePermission(actor, "offers.edit");
        guardFreeText({ label: input.label });
        this.db.transaction((tx) => {
          try {
            tx.prepare(
              "INSERT INTO offer_score_criterion (key, label, position) VALUES (?,?,?)",
            ).run(input.key, input.label, input.position);
          } catch {
            throw new CatalogueRefusal(409, "Criterion exists", ["criterion_exists"]);
          }
          recordAudit(
            tx,
            {
              actorId: actor.userId,
              actorType: actor.actorType,
              action: "offer.criterion.add",
              entityType: "offer_score_criterion",
              entityId: input.key,
              outcome: "success",
              correlationId: actor.correlationId,
            },
            actor.now,
          );
        });
      },
    );
  }

  setScore(actor: CatalogueActor, raw: unknown): ScoreView {
    const input = parseOrThrow(ScoreInputSchema, raw);
    return audited(this.db, actor, "offer.score.set.refused", "offer_score", input.offerId, () => {
      requirePermission(actor, "offers.edit");
      if (input.rationale) guardFreeText({ rationale: input.rationale });
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        const head = getHead(tx, input.offerId);
        if (!head) throw new HttpError(404, "Offer not found");
        if (
          !tx.prepare("SELECT 1 FROM offer_score_criterion WHERE key = ?").get(input.criterionKey)
        ) {
          throw new HttpError(404, "Criterion not found");
        }
        if (input.score < this.settings.scoreMin || input.score > this.settings.scoreMax) {
          throw new CatalogueRefusal(
            400,
            "Score out of range",
            ["score_out_of_range"],
            [],
            `A score must be a whole number from ${this.settings.scoreMin} to ${this.settings.scoreMax}.`,
          );
        }
        const id = uuidv7();
        tx.prepare(
          "INSERT INTO offer_score (id, offer_id, criterion_key, score, status, rationale, set_by, set_at) VALUES (?,?,?,?,'hypothesis',?,?,?)",
        ).run(
          id,
          input.offerId,
          input.criterionKey,
          input.score,
          input.rationale ?? null,
          actor.userId,
          at,
        );
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "offer.score.set",
            entityType: "offer_score",
            entityId: input.offerId,
            outcome: "success",
            after: { criterion: input.criterionKey, score: input.score },
            correlationId: actor.correlationId,
          },
          actor.now,
        );
        emitOfferUpdated(tx, ctxOf(actor), {
          offerId: input.offerId,
          versionNo: head.latestVersionNo,
          change: "score",
          status: latestStatus(tx, input.offerId, head.latestVersionNo).status,
        });
        return score(tx.prepare("SELECT * FROM offer_score WHERE id = ?").get(id) as Row);
      });
    });
  }
}
