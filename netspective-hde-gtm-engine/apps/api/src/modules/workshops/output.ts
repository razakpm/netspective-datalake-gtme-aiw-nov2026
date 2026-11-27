import { createHash } from "node:crypto";
import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  buildOutputSections,
  editableTexts,
  localDateOf,
  OUTPUT_PROBLEMS,
  outputProblems,
  renderOutputHtml,
  type FindingsContent,
  type OutputProblemCode,
  type OutputSections,
} from "@gtm/domain";
import type { FileStorageProvider, PdfRenderer } from "@gtm/providers";
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
import { coverReport } from "../claims/index.js";
import { offerFacts } from "../offers/index.js";
import { auditChange, staleVersion, workshopOr404 } from "./actor.js";
import {
  approveOutputRow,
  insertOutput,
  insertShare,
  listFindings,
  listHistory,
  listOutputs,
  listShares,
  type FindingRow,
  type OutputRow,
  type ShareRow,
  type WorkshopRow,
} from "./repository.js";

// The one-page buyer output (feature 007, spec FR-030 to FR-032, research R-12). Built from finalised
// findings, edited as revisions in the parts a person may change, approved by a person with the approval
// right and fixed as a one-page PDF. Sharing is recorded; nothing here sends anything.

export interface OutputSettings {
  maxChars: number;
  businessTimeZone: string;
}

export interface OutputDeps {
  files: FileStorageProvider;
  renderer: PdfRenderer;
  settings: OutputSettings;
}

const items = z.array(z.string().trim().min(2).max(150)).min(1).max(8);
export const EditOutputSchema = z
  .object({
    baseRevisionNo: z.number().int().min(1),
    sections: z
      .object({
        title: z.string().trim().min(2).max(200),
        summary: z.string().trim().max(1200),
        nextStep: z.string().trim().max(500),
        inScope: items,
        outOfScope: items,
      })
      .strict(),
  })
  .strict();
export const ShareSchema = z
  .object({
    how: z.enum(["handed_over", "copied_link", "other"]),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

const GENERATED_KEYS = [
  "organisation",
  "offerName",
  "date",
  "findings",
  "unknowns",
  "boundaryNote",
  "disclaimer",
];

export interface OutputView {
  id: string;
  revisionNo: number;
  state: OutputRow["state"];
  sections: OutputSections;
  findingVersionNo: number;
  editedBy: string;
  editedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  pdfPages: number | null;
  /** The findings changed after this revision was made. */
  outOfDate: boolean;
  /** What stops approval of a current draft. */
  problems: { code: string; message: string }[];
}

const refuse = (status: number, codes: string[], detail: string) =>
  new CatalogueRefusal(status, "Output refused", codes, [], detail);
const outOfDate = () =>
  refuse(
    409,
    ["output_out_of_date"],
    "The findings changed after this page was made. Make a new draft.",
  );

interface State {
  workshop: WorkshopRow;
  findings: FindingRow[];
  revisions: OutputRow[];
}

export class OutputService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly d: OutputDeps,
  ) {}

  get(
    actor: CatalogueActor,
    workshopId: string,
  ): { latest: OutputView | null; revisions: OutputView[]; shares: ShareRow[] } {
    return audited(this.db, actor, "workshop.read.refused", "workshop", workshopId, () => {
      requirePermission(actor, "workshops.read");
      const tx = this.db.raw;
      const state = this.state(tx, workshopId);
      const views = state.revisions.map((r) => this.view(tx, state, r, nowOf(actor))).reverse();
      return {
        latest: views[0] ?? null,
        revisions: views,
        shares: listShares(tx, workshopId),
      };
    });
  }

  generate(actor: CatalogueActor, workshopId: string): OutputView {
    return audited(
      this.db,
      actor,
      "workshop.output.generate.refused",
      "workshop",
      workshopId,
      () => {
        requirePermission(actor, "workshops.edit");
        return this.db.transaction((tx) => {
          const state = this.state(tx, workshopId);
          const finding = state.findings.at(-1);
          if (!finding || finding.state !== "finalised") {
            throw refuse(409, ["output_not_ready"], "Finalise the findings first.");
          }
          const sections = this.build(tx, state.workshop, finding);
          return this.addRevision(tx, actor, state, finding.id, sections, "generate");
        });
      },
    );
  }

  edit(actor: CatalogueActor, workshopId: string, raw: unknown): OutputView {
    return audited(this.db, actor, "workshop.output.edit.refused", "workshop", workshopId, () => {
      requirePermission(actor, "workshops.edit");
      this.refuseFixedParts(raw);
      const input = parseOrThrow(EditOutputSchema, raw);
      guardFreeText({ sections: input.sections });
      return this.db.transaction((tx) => {
        const state = this.state(tx, workshopId);
        const latest = this.latest(state);
        if (latest.revisionNo !== input.baseRevisionNo) throw staleVersion();
        if (this.isOutOfDate(state, latest)) throw outOfDate();
        const sections: OutputSections = {
          ...(JSON.parse(latest.sectionsJson) as OutputSections),
          ...input.sections,
        };
        return this.addRevision(tx, actor, state, latest.findingId, sections, "edit");
      });
    });
  }

  async approve(actor: CatalogueActor, workshopId: string): Promise<OutputView> {
    return auditedAsync(
      this.db,
      actor,
      "workshop.output.approve.refused",
      "workshop",
      workshopId,
      async () => {
        requirePermission(actor, "workshops.output.approve");
        const state = this.state(this.db.raw, workshopId);
        const draft = this.latest(state);
        if (draft.state !== "draft") {
          throw refuse(409, ["already_approved"], "This revision is already approved.");
        }
        if (this.isOutOfDate(state, draft)) throw outOfDate();
        const sections = JSON.parse(draft.sectionsJson) as OutputSections;
        const problems = this.problems(this.db.raw, state, draft, sections, nowOf(actor));
        if (problems.length > 0) {
          throw refuse(
            422,
            problems.map((p) => p.code),
            problems.map((p) => p.message).join(" "),
          );
        }
        const rendered = await this.d.renderer.render(renderOutputHtml(sections));
        if (!rendered.ok) {
          throw refuse(
            422,
            ["render_failed"],
            "The PDF could not be made. The draft is unchanged; please try again.",
          );
        }
        if (rendered.value.pages !== 1) {
          throw refuse(422, ["over_one_page"], OUTPUT_PROBLEMS.over_one_page);
        }
        const key = `workshop-${workshopId}-output-${draft.id}.pdf`;
        const stored = await this.d.files.put(key, rendered.value.bytes, "application/pdf", {
          // A key names one revision, so a leftover of an earlier failed approval may be replaced.
          overwrite: true,
        });
        if (!stored.ok) {
          throw refuse(422, ["storage_failed"], "The PDF could not be stored. Please try again.");
        }
        try {
          return this.db.transaction((tx) => {
            const now = this.state(tx, workshopId);
            // Someone may have edited or corrected while the page was being made.
            if (this.latest(now).id !== draft.id) throw staleVersion();
            if (this.isOutOfDate(now, draft)) throw outOfDate();
            const approved = approveOutputRow(tx, draft.id, {
              by: actor.userId as string,
              at: nowOf(actor).toISOString(),
              storageKey: key,
              sha256: createHash("sha256").update(rendered.value.bytes).digest("hex"),
            });
            if (!approved) throw staleVersion();
            auditChange(
              tx,
              actor,
              "workshop.output.approve",
              { type: "workshop_output_document", id: draft.id },
              { workshop_id: workshopId, revision_no: draft.revisionNo },
            );
            const after = this.state(tx, workshopId);
            return this.view(tx, after, this.latest(after), nowOf(actor));
          });
        } catch (error) {
          const kept = listOutputs(this.db.raw, workshopId).some((r) => r.pdfStorageKey === key);
          if (!kept) await this.d.files.delete(key);
          throw error;
        }
      },
    );
  }

  async pdf(
    actor: CatalogueActor,
    workshopId: string,
  ): Promise<{ bytes: Buffer; fileName: string }> {
    return auditedAsync(
      this.db,
      actor,
      "workshop.output.download.refused",
      "workshop",
      workshopId,
      async () => {
        requirePermission(actor, "workshops.read");
        const approved = this.shareable(this.state(this.db.raw, workshopId));
        if (approved.fileDeletedAt !== null) {
          throw refuse(410, ["file_deleted"], "This file was deleted when its retention ended.");
        }
        const file = await this.d.files.get(approved.pdfStorageKey as string);
        if (!file) throw refuse(410, ["file_deleted"], "This file is no longer there.");
        const chunks: Buffer[] = [];
        for await (const chunk of file.stream) chunks.push(Buffer.from(chunk as Uint8Array));
        return { bytes: Buffer.concat(chunks), fileName: approved.pdfStorageKey as string };
      },
    );
  }

  share(actor: CatalogueActor, workshopId: string, raw: unknown): ShareRow {
    return audited(this.db, actor, "workshop.output.share.refused", "workshop", workshopId, () => {
      requirePermission(actor, "workshops.edit");
      const input = parseOrThrow(ShareSchema, raw);
      if (input.note) guardFreeText({ note: input.note });
      return this.db.transaction((tx) => {
        const approved = this.shareable(this.state(tx, workshopId));
        const row: ShareRow = {
          id: uuidv7(),
          outputId: approved.id,
          how: input.how,
          note: input.note || null,
          sharedBy: actor.userId as string,
          sharedAt: nowOf(actor).toISOString(),
        };
        insertShare(tx, row);
        auditChange(
          tx,
          actor,
          "workshop.output.share",
          { type: "workshop_output_document", id: approved.id },
          { workshop_id: workshopId, how: row.how },
        );
        return row;
      });
    });
  }

  // ---- inside -------------------------------------------------------------------------------------

  private state(tx: Tx, workshopId: string): State {
    return {
      workshop: workshopOr404(tx, workshopId),
      findings: listFindings(tx, workshopId),
      revisions: listOutputs(tx, workshopId),
    };
  }

  private latest(state: State): OutputRow {
    const latest = state.revisions.at(-1);
    if (!latest) throw refuse(409, ["output_not_ready"], "No page has been made yet.");
    return latest;
  }

  /** Only the latest revision, approved and built from the current findings, can leave the system. */
  private shareable(state: State): OutputRow {
    const latest = this.latest(state);
    if (latest.state !== "approved") {
      throw refuse(409, ["output_not_ready"], "Only an approved page can be shared or downloaded.");
    }
    if (this.isOutOfDate(state, latest)) throw outOfDate();
    return latest;
  }

  private isOutOfDate(state: State, revision: OutputRow): boolean {
    return state.findings.at(-1)?.id !== revision.findingId;
  }

  private build(tx: Tx, workshop: WorkshopRow, finding: FindingRow): OutputSections {
    const held = listHistory(tx, workshop.id).find((h) => h.toState === "held");
    const heldAt = workshop.scheduledAt ?? held?.changedAt ?? finding.createdAt;
    return buildOutputSections({
      kind: finding.kind,
      content: JSON.parse(finding.contentJson) as FindingsContent,
      waiverReason: finding.waiverReason,
      organisation: getAccount(tx, workshop.accountId)?.name ?? "",
      offerName: offerFacts(tx, workshop.offerId)?.name ?? workshop.offerId,
      date: localDateOf(new Date(heldAt), this.d.settings.businessTimeZone),
    });
  }

  private refuseFixedParts(raw: unknown): void {
    const sections = (raw as { sections?: Record<string, unknown> } | undefined)?.sections;
    if (!sections || typeof sections !== "object") return;
    if (GENERATED_KEYS.some((key) => key in sections)) {
      throw refuse(422, ["generated_section_changed"], OUTPUT_PROBLEMS.generated_section_changed);
    }
    for (const key of ["inScope", "outOfScope"] as const) {
      const value = sections[key];
      if (!Array.isArray(value) || value.length === 0) {
        throw refuse(422, ["scope_section_missing"], OUTPUT_PROBLEMS.scope_section_missing);
      }
    }
  }

  private problems(
    tx: Tx,
    state: State,
    revision: OutputRow,
    sections: OutputSections,
    now: Date,
  ): { code: OutputProblemCode; message: string }[] {
    const finding = state.findings.find((f) => f.id === revision.findingId) as FindingRow;
    const found = outputProblems(sections, {
      generated: this.build(tx, state.workshop, finding),
      maxChars: this.d.settings.maxChars,
    });
    // Everything a buyer reads, apart from the fixed boundary sentence and disclaimer.
    const claimed = [...editableTexts(sections), sections.findings, sections.unknowns].join("\n");
    if (coverReport(tx, claimed, now.toISOString()).uncovered.length > 0) {
      found.push({ code: "restricted_wording", message: OUTPUT_PROBLEMS.restricted_wording });
    }
    return found;
  }

  private addRevision(
    tx: Tx,
    actor: CatalogueActor,
    state: State,
    findingId: string,
    sections: OutputSections,
    how: "generate" | "edit",
  ): OutputView {
    const row: OutputRow = {
      id: uuidv7(),
      workshopId: state.workshop.id,
      findingId,
      revisionNo: (state.revisions.at(-1)?.revisionNo ?? 0) + 1,
      sectionsJson: JSON.stringify(sections),
      state: "draft",
      editedBy: actor.userId as string,
      editedAt: nowOf(actor).toISOString(),
      approvedBy: null,
      approvedAt: null,
      pdfStorageKey: null,
      pdfSha256: null,
      pdfPages: null,
      fileDeletedAt: null,
    };
    insertOutput(tx, row);
    auditChange(
      tx,
      actor,
      `workshop.output.${how}`,
      { type: "workshop_output_document", id: row.id },
      { workshop_id: row.workshopId, revision_no: row.revisionNo },
    );
    return this.view(tx, this.state(tx, row.workshopId), row, nowOf(actor));
  }

  private view(tx: Tx, state: State, row: OutputRow, now: Date): OutputView {
    const sections = JSON.parse(row.sectionsJson) as OutputSections;
    const stale = this.isOutOfDate(state, row);
    const latest = row.id === state.revisions.at(-1)?.id;
    return {
      id: row.id,
      revisionNo: row.revisionNo,
      state: row.state,
      sections,
      findingVersionNo: state.findings.find((f) => f.id === row.findingId)?.versionNo ?? 0,
      editedBy: row.editedBy,
      editedAt: row.editedAt,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      pdfPages: row.pdfPages,
      outOfDate: stale,
      problems:
        row.state === "draft" && latest && !stale
          ? this.problems(tx, state, row, sections, now)
          : [],
    };
  }
}
