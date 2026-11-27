import type { SqliteDatabase } from "@gtm/db";
import { guardValue, supportDraftItems, type DraftItem } from "@gtm/domain";
import type { WorkshopFindingsDraft } from "@gtm/ai-contracts";
import { z } from "zod";
import { parseOrThrow } from "../../http/errors.js";
import {
  auditedAsync,
  CatalogueRefusal,
  guardFreeText,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { buildModelInput } from "../providers/index.js";
import { auditChange, workshopOr404 } from "./actor.js";
import { callModel, type ModelDeps } from "./model.js";
import { FINDINGS_OPEN, intakeFacts } from "./findings.js";

// The notes-assist (feature 007, spec FR-029, research R-09). A model may suggest findings entries from
// the operator's pasted notes. Only what the notes bear out is returned; nothing is stored, nothing is
// confirmed, finalised or moved, and the notes and the suggestion are never kept.

export const SuggestSchema = z.object({ notes: z.string().trim().min(20).max(8000) }).strict();

export interface Suggestion {
  entityIds: { workshopId: string; accountId: string };
  confidence: "low" | "medium" | "high";
  rationale: string;
  reviewStatus: "unreviewed";
  model: string | null;
  promptVersion: string | null;
  schemaVersion: string | null;
  items: DraftItem[];
  dropped: number;
  notice: string | null;
}

export class SuggestService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly d: ModelDeps,
  ) {}

  async suggest(actor: CatalogueActor, workshopId: string, raw: unknown): Promise<Suggestion> {
    return auditedAsync(
      this.db,
      actor,
      "workshop.findings.suggest.refused",
      "workshop",
      workshopId,
      async () => {
        requirePermission(actor, "workshops.edit");
        const { notes } = parseOrThrow(SuggestSchema, raw);
        const workshop = workshopOr404(this.db.raw, workshopId);
        if (!FINDINGS_OPEN.has(workshop.state)) {
          throw new CatalogueRefusal(
            422,
            "Not open",
            ["findings_not_open"],
            [],
            "Findings are recorded once the session has been held.",
          );
        }
        // Patient-like notes are refused before any model is called.
        guardFreeText({ notes });
        const facts = intakeFacts(this.db.raw, workshop);
        const result = await callModel<WorkshopFindingsDraft>(this.db, this.d, actor, {
          promptName: "workshop-findings",
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
                intake: [],
                evidence: [],
                fieldNames: facts.fieldNames,
              },
              notes,
              reference: { signalTypeKeys: [], categoryKeys: [], capabilityKeys: [] },
            }),
        });
        const unavailable = (detail: string) =>
          new CatalogueRefusal(503, "No suggestion", ["ai_unavailable"], [], detail);
        if (!result.ok) throw unavailable(result.notice);
        const { data } = result;
        if (
          data.entityIds.workshopId !== workshopId ||
          data.entityIds.accountId !== workshop.accountId ||
          guardValue(data).decision !== "allow"
        ) {
          throw unavailable("The model's answer was not usable. Fill the findings in by hand.");
        }
        const supported = supportDraftItems(data.items, {
          kind: facts.kind,
          notes,
          fieldNames: facts.fieldNames,
          knownNames: facts.knownNames,
        });
        this.db.transaction((tx) =>
          auditChange(
            tx,
            actor,
            "workshop.findings.suggest",
            { type: "workshop", id: workshopId },
            {
              ai_invocation_id: result.invocation.id,
              suggested: supported.items.length,
              dropped: supported.dropped,
            },
          ),
        );
        return {
          entityIds: data.entityIds,
          confidence: data.confidence,
          rationale: data.rationale,
          reviewStatus: "unreviewed" as const,
          model: result.invocation.model,
          promptVersion: result.invocation.promptVersion,
          schemaVersion: result.invocation.schemaVersion,
          items: supported.items,
          dropped: supported.dropped,
          notice:
            supported.dropped > 0
              ? `${supported.dropped} suggestion(s) were left out because the notes do not bear them out.`
              : null,
        };
      },
    );
  }
}
