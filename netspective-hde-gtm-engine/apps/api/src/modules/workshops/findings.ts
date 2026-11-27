import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  blockingShortfalls,
  checkWorkshopTransition,
  DELAY_SOURCES_REQUIRED,
  FINDINGS_DISCLAIMER,
  FINDINGS_SCHEMA_VERSION,
  findingsSchemaFor,
  findingsShortfalls,
  findingsTextProblems,
  findingsTexts,
  newOffer1Draft,
  newOffer6Draft,
  scopeDurationStated,
  summariseFields,
  type FieldSummary,
  type FindingsContent,
  type FindingsKind,
  type Offer1Findings,
  type Offer6Findings,
  type Shortfall,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { z, type ZodType } from "zod";
import { parseOrThrow } from "../../http/errors.js";
import {
  audited,
  CatalogueRefusal,
  guardFreeText,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { loadRequestForWorkshop } from "../engagement/index.js";
import { auditChange, staleVersion, workshopOr404 } from "./actor.js";
import { emitWorkshopFindingsRecorded } from "./events.js";
import {
  finaliseDraft,
  insertFinding,
  insertHistory,
  listFindings,
  updateDraftContent,
  updateWorkshop,
  type FindingRow,
  type WorkshopRow,
} from "./repository.js";

// Typed findings (feature 007, spec FR-018 to FR-028, research R-06 and R-07). A draft is saved and
// finalised by a person under the pure rules. A finalised version never changes; a correction is a new
// version with a reason. The server records who confirmed a delay. A value, a sample record, a price, a
// guarantee or patient-like text refuses the whole entry. Nothing about a buyer's qualification is held.

export const SaveFindingsSchema = z
  .object({
    content: z.record(z.string(), z.unknown()),
    lockNo: z.number().int().min(1).optional(),
    correctionReason: z.string().trim().min(3).max(300).optional(),
  })
  .strict();
export const FinaliseFindingsSchema = z
  .object({ waiverReason: z.string().trim().min(10).max(300).optional() })
  .strict();

export interface FindingView {
  id: string;
  versionNo: number;
  kind: FindingsKind;
  state: "draft" | "finalised";
  content: FindingsContent;
  lockNo: number;
  waiverReason: string | null;
  correctionReason: string | null;
  finalisedBy: string | null;
  finalisedAt: string | null;
  updatedAt: string;
}

export interface FindingsView {
  current: FindingView | null;
  versions: FindingView[];
  shortfalls: Shortfall[];
  /** Offer 6 only. */
  summary?: FieldSummary;
  /** What a first draft starts from, when nothing has been saved yet. */
  template?: FindingsContent;
}

/** The workshop's offer kind and what its intake names. */
export interface IntakeFacts {
  kind: FindingsKind;
  fieldNames: string[];
  knownNames: string[];
}

export function intakeFacts(tx: Tx, workshop: WorkshopRow): IntakeFacts {
  const intake = loadRequestForWorkshop(tx, workshop.requestId)?.intake;
  const payload = (intake?.payload ?? {}) as {
    fieldNames?: string[];
    sourceSystems?: string[];
    interfaceTypes?: string[];
  };
  return {
    kind: intake?.kind ?? "offer_1",
    fieldNames: payload.fieldNames ?? [],
    knownNames: [...(payload.sourceSystems ?? []), ...(payload.interfaceTypes ?? [])],
  };
}

/** A first draft needs a held workshop; a correction also comes after the findings were recorded. */
export const FINDINGS_OPEN: ReadonlySet<WorkshopRow["state"]> = new Set([
  "held",
  "findings_recorded",
  "closed",
]);

const refuse = (status: number, codes: string[], detail: string) =>
  new CatalogueRefusal(status, "Findings refused", codes, [], detail);

const view = (f: FindingRow): FindingView => ({
  id: f.id,
  versionNo: f.versionNo,
  kind: f.kind,
  state: f.state,
  content: JSON.parse(f.contentJson) as FindingsContent,
  lockNo: f.lockNo,
  waiverReason: f.waiverReason,
  correctionReason: f.correctionReason,
  finalisedBy: f.finalisedBy,
  finalisedAt: f.finalisedAt,
  updatedAt: f.updatedAt,
});

const PROBLEM_WORDS = {
  price_stated: "Findings do not state a price, a fee or a budget.",
  guarantee_stated: "Findings do not state a guarantee.",
  sample_record_not_accepted: "Findings hold no sample records or values.",
} as const;

type Source = Offer1Findings["delaySources"][number];
const sameSource = (a: Source, b: Source): boolean =>
  a.description === b.description &&
  a.ownerClass === b.ownerClass &&
  a.confirmation === b.confirmation &&
  JSON.stringify(a.delay) === JSON.stringify(b.delay);

/** Who confirmed what is written here, never taken from the caller. */
function stampConfirmations(
  content: Offer1Findings,
  before: Offer1Findings | undefined,
  by: string,
  at: string,
): Offer1Findings {
  return {
    ...content,
    delaySources: content.delaySources.map((source) => {
      const given: Source = { ...source };
      delete given.confirmedBy;
      delete given.confirmedAt;
      if (given.confirmation === "unknown") return given;
      const kept = before?.delaySources.find((s) => sameSource(s, source));
      return kept?.confirmedBy && kept.confirmedAt
        ? { ...given, confirmedBy: kept.confirmedBy, confirmedAt: kept.confirmedAt }
        : { ...given, confirmedBy: by, confirmedAt: at };
    }),
  };
}

export class FindingsService {
  constructor(private readonly db: SqliteDatabase) {}

  get(actor: CatalogueActor, workshopId: string): FindingsView {
    return audited(this.db, actor, "workshop.read.refused", "workshop", workshopId, () => {
      requirePermission(actor, "workshops.read");
      const workshop = workshopOr404(this.db.raw, workshopId);
      const facts = intakeFacts(this.db.raw, workshop);
      const versions = listFindings(this.db.raw, workshopId).map(view);
      const current = versions.at(-1) ?? null;
      const template =
        facts.kind === "offer_1" ? newOffer1Draft() : newOffer6Draft(facts.fieldNames);
      const content = current?.content ?? template;
      return {
        current,
        versions,
        shortfalls: findingsShortfalls(facts.kind, content, facts.fieldNames),
        ...(facts.kind === "offer_6"
          ? { summary: summariseFields((content as Offer6Findings).fields) }
          : {}),
        ...(current ? {} : { template }),
      };
    });
  }

  save(actor: CatalogueActor, workshopId: string, raw: unknown): FindingView {
    return audited(this.db, actor, "workshop.findings.save.refused", "workshop", workshopId, () => {
      requirePermission(actor, "workshops.edit");
      const input = parseOrThrow(SaveFindingsSchema, raw);
      const workshop = this.openWorkshop(this.db.raw, workshopId);
      const facts = intakeFacts(this.db.raw, workshop);
      const content = this.accept(facts, input.content);
      if (input.correctionReason) {
        guardFreeText({ correctionReason: input.correctionReason });
      }
      const at = nowOf(actor).toISOString();
      const by = actor.userId as string;
      return this.db.transaction((tx) => {
        const latest = listFindings(tx, workshopId).at(-1);
        const before = latest ? (JSON.parse(latest.contentJson) as Offer1Findings) : undefined;
        const stored =
          facts.kind === "offer_1"
            ? stampConfirmations(content as Offer1Findings, before, by, at)
            : content;
        const contentJson = JSON.stringify(stored);
        let id: string;
        if (latest?.state === "draft") {
          if (!updateDraftContent(tx, latest.id, contentJson, input.lockNo ?? 0, at)) {
            throw staleVersion();
          }
          id = latest.id;
        } else {
          if (latest && !input.correctionReason) {
            throw refuse(
              422,
              ["correction_reason_required"],
              "These findings are finalised. Say why they are being corrected.",
            );
          }
          // A copy that expected a draft is out of date once someone finalised it.
          if (latest && input.lockNo !== undefined && input.lockNo !== latest.lockNo) {
            throw staleVersion();
          }
          id = uuidv7();
          insertFinding(tx, {
            id,
            workshopId,
            versionNo: (latest?.versionNo ?? 0) + 1,
            kind: facts.kind,
            schemaVersion: FINDINGS_SCHEMA_VERSION,
            contentJson,
            state: "draft",
            waiverReason: null,
            correctionReason: latest ? (input.correctionReason as string) : null,
            lockNo: 1,
            createdBy: by,
            createdAt: at,
            updatedAt: at,
            finalisedBy: null,
            finalisedAt: null,
          });
        }
        const saved = listFindings(tx, workshopId).find((f) => f.id === id) as FindingRow;
        auditChange(
          tx,
          actor,
          "workshop.findings.save",
          { type: "workshop_finding", id },
          { workshop_id: workshopId, version_no: saved.versionNo },
        );
        return view(saved);
      });
    });
  }

  finalise(actor: CatalogueActor, workshopId: string, raw: unknown = {}): FindingView {
    return audited(
      this.db,
      actor,
      "workshop.findings.finalise.refused",
      "workshop",
      workshopId,
      () => {
        requirePermission(actor, "workshops.edit");
        const input = parseOrThrow(FinaliseFindingsSchema, raw ?? {});
        const at = nowOf(actor).toISOString();
        const by = actor.userId as string;
        return this.db.transaction((tx) => {
          const workshop = this.openWorkshop(tx, workshopId);
          const draft = listFindings(tx, workshopId).at(-1);
          if (!draft || draft.state !== "draft") {
            throw refuse(409, ["findings_not_draft"], "There is no draft to finalise.");
          }
          const facts = intakeFacts(tx, workshop);
          const content = this.accept(facts, JSON.parse(draft.contentJson));
          if (input.waiverReason) {
            guardFreeText({ waiverReason: input.waiverReason });
            this.refuseProblems([input.waiverReason]);
          }
          const shortfalls = findingsShortfalls(facts.kind, content, facts.fieldNames);
          const blocking = blockingShortfalls(shortfalls, input.waiverReason);
          if (blocking.length > 0) {
            throw refuse(
              422,
              ["findings_incomplete", ...blocking.map((s) => s.code)],
              blocking.map((s) => s.message).join(" "),
            );
          }
          const waived = shortfalls.some((s) => s.waivable);
          finaliseDraft(tx, draft.id, by, at, waived ? (input.waiverReason as string) : null);
          if (workshop.state === "held")
            this.recordFindings(tx, actor, workshop, draft, waived, at);
          auditChange(
            tx,
            actor,
            "workshop.findings.finalise",
            { type: "workshop_finding", id: draft.id },
            { workshop_id: workshopId, version_no: draft.versionNo, waived },
          );
          return view(listFindings(tx, workshopId).at(-1) as FindingRow);
        });
      },
    );
  }

  // ---- inside -------------------------------------------------------------------------------------

  private openWorkshop(tx: Tx, workshopId: string): WorkshopRow {
    const workshop = workshopOr404(tx, workshopId);
    if (!FINDINGS_OPEN.has(workshop.state)) {
      throw refuse(
        409,
        ["invalid_transition"],
        "Findings are recorded once the session has been held.",
      );
    }
    return workshop;
  }

  /** Shape, the fixed parts, the boundary guard and the statements findings never make. */
  private accept(facts: IntakeFacts, raw: unknown): FindingsContent {
    const given = raw as { delaySources?: unknown[]; fields?: { intakeName?: unknown }[] };
    if (facts.kind === "offer_1") {
      if (Array.isArray(given.delaySources) && given.delaySources.length > DELAY_SOURCES_REQUIRED) {
        throw refuse(422, ["too_many_delay_sources"], "Choose the three biggest delay sources.");
      }
    } else if (
      Array.isArray(given.fields) &&
      (given.fields.length !== facts.fieldNames.length ||
        given.fields.some((f, i) => f?.intakeName !== facts.fieldNames[i]))
    ) {
      throw refuse(
        422,
        ["field_list_fixed"],
        "The fields are the ten named in the intake; none can be added or replaced.",
      );
    }
    const content = parseOrThrow(findingsSchemaFor(facts.kind) as ZodType<FindingsContent>, raw);
    guardFreeText({ content });
    this.refuseProblems(findingsTexts(facts.kind, content));
    if (facts.kind === "offer_6") {
      const six = content as Offer6Findings;
      if (six.disclaimer !== FINDINGS_DISCLAIMER) {
        throw refuse(422, ["disclaimer_changed"], "The disclaimer is fixed.");
      }
      if (scopeDurationStated(six.inputAuditScope)) {
        throw refuse(422, ["duration_stated"], "The scope does not state how long anything takes.");
      }
    }
    return content;
  }

  private refuseProblems(texts: readonly string[]): void {
    const problems = findingsTextProblems(texts);
    const first = problems[0];
    if (first) throw refuse(422, problems, PROBLEM_WORDS[first]);
  }

  /** The first finalisation moves the workshop to findings recorded and announces it. */
  private recordFindings(
    tx: Tx,
    actor: CatalogueActor,
    workshop: WorkshopRow,
    draft: FindingRow,
    waived: boolean,
    at: string,
  ): void {
    const check = checkWorkshopTransition(workshop.state, "record_findings");
    if (!check.ok) throw refuse(409, [check.code], "The workshop cannot record findings now.");
    if (!updateWorkshop(tx, workshop.id, { state: check.to }, workshop.lockNo, at)) {
      throw staleVersion();
    }
    insertHistory(tx, workshop.id, {
      id: uuidv7(),
      fromState: workshop.state,
      toState: check.to,
      note: null,
      scheduledFrom: null,
      scheduledTo: null,
      changedBy: actor.userId as string,
      changedAt: at,
    });
    emitWorkshopFindingsRecorded(tx, actor, {
      workshopId: workshop.id,
      offerId: workshop.offerId,
      versionNo: draft.versionNo,
      waived,
    });
  }
}
