import type { SqliteDatabase } from "@gtm/db";
import {
  baselineBrief,
  guardValue,
  verifyBrief,
  type BriefContent,
  type BriefContext,
  type BriefEvidence,
} from "@gtm/domain";
import type { WorkshopBrief } from "@gtm/ai-contracts";
import { v7 as uuidv7 } from "uuid";
import {
  audited,
  auditedAsync,
  CatalogueRefusal,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { loadRequestForWorkshop } from "../engagement/index.js";
import type { HypothesisService } from "../hypotheses/index.js";
import { evidenceFor } from "../icp/index.js";
import { buildModelInput } from "../providers/index.js";
import { currentEvidence } from "../signals/index.js";
import { auditChange, workshopOr404 } from "./actor.js";
import { intakeFacts } from "./findings.js";
import { callModel, type ModelDeps } from "./model.js";
import {
  insertBrief,
  listBriefs,
  markBriefRow,
  type BriefRow,
  type WorkshopRow,
} from "./repository.js";

// The preparation brief (feature 007, spec FR-010 to FR-013, research R-08). A baseline from the records,
// improved by a model only when one is switched on and its answer passes verification. Text from the intake
// or the records is data, is left out when it fails the data check, and can change nothing. Earlier briefs
// stay readable. A brief is advice: nothing in it is recorded as fact.

export interface BriefDeps extends ModelDeps {
  hypotheses: HypothesisService;
  artifactKinds: string[];
}

export interface BriefView {
  id: string;
  versionNo: number;
  source: "baseline" | "model";
  model: string | null;
  promptVersion: string | null;
  schemaVersion: string | null;
  confidence: BriefRow["confidence"];
  rationale: string | null;
  reviewStatus: BriefRow["reviewStatus"];
  reviewedBy: string | null;
  reviewedAt: string | null;
  superseded: boolean;
  /** Why the baseline was used, on the brief just made. */
  notice: string | null;
  content: BriefContent;
  createdAt: string;
}

const CLOSED_TO_BRIEFS: ReadonlySet<WorkshopRow["state"]> = new Set([
  "cancelled",
  "no_show",
  "closed",
]);

const view = (row: BriefRow, latestNo: number, notice: string | null = null): BriefView => ({
  id: row.id,
  versionNo: row.versionNo,
  source: row.source,
  model: row.model,
  promptVersion: row.promptVersion,
  schemaVersion: row.schemaVersion,
  confidence: row.confidence,
  rationale: row.rationale,
  reviewStatus: row.reviewStatus,
  reviewedBy: row.reviewedBy,
  reviewedAt: row.reviewedAt,
  superseded: row.versionNo < latestNo,
  notice,
  content: JSON.parse(row.contentJson) as BriefContent,
  createdAt: row.createdAt,
});

const passes = (value: unknown): boolean => guardValue(value).decision === "allow";

export class BriefService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly d: BriefDeps,
  ) {}

  get(
    actor: CatalogueActor,
    workshopId: string,
  ): { latest: BriefView | null; earlier: BriefView[] } {
    return audited(this.db, actor, "workshop.read.refused", "workshop", workshopId, () => {
      requirePermission(actor, "workshops.read");
      workshopOr404(this.db.raw, workshopId);
      const rows = listBriefs(this.db.raw, workshopId);
      const latestNo = rows.at(-1)?.versionNo ?? 0;
      const views = rows.map((r) => view(r, latestNo)).reverse();
      return { latest: views[0] ?? null, earlier: views.slice(1) };
    });
  }

  async generate(actor: CatalogueActor, workshopId: string): Promise<BriefView> {
    return auditedAsync(
      this.db,
      actor,
      "workshop.brief.generate.refused",
      "workshop",
      workshopId,
      async () => {
        requirePermission(actor, "workshops.edit");
        const workshop = workshopOr404(this.db.raw, workshopId);
        if (CLOSED_TO_BRIEFS.has(workshop.state)) {
          throw new CatalogueRefusal(
            409,
            "No brief",
            ["invalid_transition"],
            [],
            "A brief is made for a workshop that is still to be delivered.",
          );
        }
        const facts = intakeFacts(this.db.raw, workshop);
        const context: BriefContext = {
          workshopId,
          accountId: workshop.accountId,
          kind: facts.kind,
          evidence: this.evidence(workshop.accountId, nowOf(actor)),
          artifactKinds: this.d.artifactKinds,
        };
        const result = await callModel<WorkshopBrief>(this.db, this.d, actor, {
          promptName: "workshop-brief",
          workshop,
          input: (account, offerKey) =>
            buildModelInput({
              account,
              sources: [],
              signalObservations: [],
              workshop: {
                workshopId,
                accountId: workshop.accountId,
                offerKey,
                intake: this.intakeAnswers(workshop),
                evidence: [...context.evidence],
                fieldNames: facts.fieldNames,
              },
              reference: {
                signalTypeKeys: [],
                categoryKeys: [],
                capabilityKeys: [],
                artifactKinds: this.d.artifactKinds,
              },
            }),
        });

        let content = baselineBrief(context);
        let notice: string | null = result.ok ? null : result.notice;
        let made: Partial<BriefRow> = {};
        if (result.ok) {
          const verified = passes(result.data)
            ? verifyBrief(result.data, context)
            : { ok: false as const };
          if (verified.ok) {
            content = verified.content;
            made = {
              source: "model",
              aiInvocationId: result.invocation.id,
              model: result.invocation.model,
              promptVersion: result.invocation.promptVersion,
              schemaVersion: result.invocation.schemaVersion,
              confidence: result.data.confidence,
              rationale: result.data.rationale,
            };
          } else {
            notice = "The model's answer was not usable, so the checklist-only brief was made.";
          }
        }

        return this.db.transaction((tx) => {
          const versionNo = (listBriefs(tx, workshopId).at(-1)?.versionNo ?? 0) + 1;
          const row: BriefRow = {
            id: uuidv7(),
            workshopId,
            versionNo,
            contentJson: JSON.stringify(content),
            source: "baseline",
            aiInvocationId: null,
            model: null,
            promptVersion: null,
            schemaVersion: null,
            confidence: null,
            rationale: null,
            reviewStatus: "unreviewed",
            reviewedBy: null,
            reviewedAt: null,
            createdBy: actor.userId as string,
            createdAt: nowOf(actor).toISOString(),
            ...made,
          };
          insertBrief(tx, row);
          auditChange(
            tx,
            actor,
            "workshop.brief.generate",
            { type: "workshop_brief", id: row.id },
            {
              workshop_id: workshopId,
              version_no: versionNo,
              source: row.source,
              ai_invocation_id: row.aiInvocationId,
            },
          );
          return view(row, versionNo, notice);
        });
      },
    );
  }

  markReviewed(actor: CatalogueActor, workshopId: string, briefId: string): BriefView {
    return audited(
      this.db,
      actor,
      "workshop.brief.review.refused",
      "workshop_brief",
      briefId,
      () => {
        requirePermission(actor, "workshops.edit");
        return this.db.transaction((tx) => {
          const rows = listBriefs(tx, workshopId);
          const row = rows.find((r) => r.id === briefId);
          if (!row) throw new CatalogueRefusal(404, "Not found", ["unknown_brief"]);
          if (row.reviewStatus === "reviewed") {
            throw new CatalogueRefusal(
              409,
              "Already reviewed",
              ["brief_already_reviewed"],
              [],
              "This brief has already been reviewed.",
            );
          }
          markBriefRow(tx, briefId, actor.userId as string, nowOf(actor).toISOString());
          auditChange(
            tx,
            actor,
            "workshop.brief.review",
            { type: "workshop_brief", id: briefId },
            { workshop_id: workshopId, version_no: row.versionNo },
          );
          return view(
            listBriefs(tx, workshopId).find((r) => r.id === briefId) as BriefRow,
            rows.at(-1)!.versionNo,
          );
        });
      },
    );
  }

  /** Evidence records, current approved signals and accepted hypotheses, each checked before use. */
  private evidence(accountId: string, now: Date): BriefEvidence[] {
    const records: BriefEvidence[] = evidenceFor(this.db.raw, accountId);
    const signals: BriefEvidence[] = this.db
      .transaction((tx) => currentEvidence(tx, accountId, now))
      .map((s) => ({
        id: s.id,
        topic: s.typeKey,
        status: s.evidenceStatus as BriefEvidence["status"],
        text: s.observation,
      }));
    // A hypothesis is never a fact, however it was accepted.
    const hypotheses: BriefEvidence[] = this.d.hypotheses
      .list(accountId, { acceptance: "accepted", limit: 20 }, now)
      .items.map((h) => ({
        id: h.id,
        topic: h.category,
        status: h.origin === "ai" ? "ai_hypothesis" : "derived_interpretation",
        text: h.statement,
      }));
    return [...records, ...signals, ...hypotheses]
      .map((e) => ({ ...e, text: e.text.slice(0, 1000) }))
      .filter((e) => e.text.length > 0 && passes(e.text))
      .slice(0, 100);
  }

  private intakeAnswers(workshop: WorkshopRow): { label: string; text: string }[] {
    const payload = loadRequestForWorkshop(this.db.raw, workshop.requestId)?.intake?.payload;
    return Object.entries((payload ?? {}) as Record<string, unknown>)
      .map(([label, value]) => ({
        label: label.slice(0, 80),
        text: (typeof value === "string" ? value : JSON.stringify(value)).slice(0, 4000),
      }))
      .filter((answer) => answer.text.length > 0 && passes(answer.text))
      .slice(0, 30);
  }
}
