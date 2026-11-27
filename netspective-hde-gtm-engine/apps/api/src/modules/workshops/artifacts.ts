import { createHash } from "node:crypto";
import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  artifactChecklist,
  checkArtifact,
  guardValue,
  resolveGuardAction,
  type ArtifactRefusal,
  type ArtifactState,
  type ChecklistItem,
  type GuardDecision,
} from "@gtm/domain";
import type { FileStorageProvider } from "@gtm/providers";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { parseOrThrow } from "../../http/errors.js";
import type { PhiNotifier } from "../../platform/events/phi-notifier.js";
import {
  auditedAsync,
  CatalogueRefusal,
  guardFreeText,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { recordPhiBlock, type QuarantineService } from "../audit/index.js";
import { auditChange, workshopOr404 } from "./actor.js";
import {
  decideArtifact,
  getArtifact,
  insertArtifact,
  listArtifacts,
  type ArtifactRow,
} from "./repository.js";

// Non-PHI artifacts (feature 007, spec FR-014 to FR-017, research R-10; constitution IV). Free text is
// refused whole when it looks like PHI. File content that looks like PHI is held, encrypted, in the
// quarantine store and nowhere else, and the operator is alerted. If the check cannot run, nothing is
// accepted. Artifact content is never given to a model, a log, an audit record or an event.

export interface ArtifactSettings {
  kinds: string[];
  maxBytes: number;
  /** Off: flagged content is refused instead of held. */
  uploadQuarantine: boolean;
}

export interface ArtifactDeps {
  files: FileStorageProvider;
  quarantine: QuarantineService;
  notifier: PhiNotifier;
  settings: ArtifactSettings;
  guard?: typeof guardValue | undefined;
}

export const ArtifactSchema = z
  .object({
    kind: z.string().min(1).max(60),
    title: z.string().trim().min(2).max(200),
    reference: z.string().trim().max(500).optional(),
    suppliedBy: z.string().trim().max(120).optional(),
    content: z.string().optional(),
    fileName: z.string().max(200).optional(),
  })
  .strict();
export const ArtifactDecisionSchema = z
  .object({
    decision: z.enum(["release", "discard"]),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export interface ArtifactView {
  id: string;
  kind: string;
  title: string;
  reference: string | null;
  suppliedBy: string | null;
  hasContent: boolean;
  sizeBytes: number | null;
  state: ArtifactState;
  classification: "non_phi";
  holdRuleIds: string[];
  recordedBy: string;
  recordedAt: string;
  fileDeletedAt: string | null;
}

const view = (a: ArtifactRow): ArtifactView => ({
  id: a.id,
  kind: a.kind,
  title: a.title,
  reference: a.reference,
  suppliedBy: a.suppliedBy,
  hasContent: a.storageKey !== null && a.fileDeletedAt === null,
  sizeBytes: a.sizeBytes,
  state: a.state,
  classification: "non_phi",
  holdRuleIds: a.holdRuleIdsJson ? (JSON.parse(a.holdRuleIdsJson) as string[]) : [],
  recordedBy: a.recordedBy,
  recordedAt: a.recordedAt,
  fileDeletedAt: a.fileDeletedAt,
});

const REFUSALS: Record<ArtifactRefusal, [status: number, detail: string]> = {
  artifact_kind_not_allowed: [422, "That kind of artifact is not accepted."],
  reference_or_content_required: [422, "Give a reference or the text of the file."],
  binary_not_accepted: [
    422,
    "Only text files (txt, md, csv, json, log) can be kept, because nothing else can be checked. Record a reference instead.",
  ],
  content_too_large: [413, "The file is too large."],
};

const refuse = (status: number, code: string, detail: string, ruleIds: string[] = []) =>
  new CatalogueRefusal(status, "Artifact refused", [code], ruleIds, detail);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Thrown inside a transaction to read released content without taking it. */
class Peek {
  constructor(readonly content: string) {}
}

type Acceptance = { ok: true } | { ok: false; ruleIds: string[] };

export class ArtifactService {
  private readonly guard: typeof guardValue;
  constructor(
    private readonly db: SqliteDatabase,
    private readonly d: ArtifactDeps,
  ) {
    this.guard = d.guard ?? guardValue;
  }

  async record(actor: CatalogueActor, workshopId: string, raw: unknown): Promise<ArtifactView> {
    return auditedAsync(
      this.db,
      actor,
      "workshop.artifact.record.refused",
      "workshop",
      workshopId,
      async () => {
        requirePermission(actor, "workshops.edit");
        const input = parseOrThrow(ArtifactSchema, raw);
        workshopOr404(this.db.raw, workshopId);
        const check = checkArtifact(input, this.d.settings);
        if (!check.ok) {
          const [status, detail] = REFUSALS[check.code];
          throw refuse(status, check.code, detail);
        }
        guardFreeText({
          kind: input.kind,
          title: input.title,
          reference: input.reference ?? "",
          suppliedBy: input.suppliedBy ?? "",
          fileName: input.fileName ?? "",
        });
        const id = uuidv7();
        const base: ArtifactRow = {
          id,
          workshopId,
          kind: input.kind,
          title: input.title,
          reference: input.reference || null,
          storageKey: null,
          sizeBytes: null,
          contentSha256: null,
          suppliedBy: input.suppliedBy || null,
          recordedBy: actor.userId as string,
          recordedAt: nowOf(actor).toISOString(),
          state: "received",
          quarantineItemId: null,
          holdRuleIdsJson: null,
          decidedBy: null,
          decidedAt: null,
          fileDeletedAt: null,
        };
        const content = input.content || undefined;
        if (content === undefined) return this.insert(actor, base);

        const decision = this.check(content);
        if (decision.decision !== "allow") return this.flagged(actor, base, content, decision);

        const key = `workshop-${workshopId}-${input.kind}-${id}.${check.extension}`;
        await this.store(key, content);
        try {
          return this.insert(actor, {
            ...base,
            storageKey: key,
            sizeBytes: check.sizeBytes,
            contentSha256: sha256(content),
          });
        } catch (error) {
          await this.d.files.delete(key);
          throw error;
        }
      },
    );
  }

  async list(
    actor: CatalogueActor,
    workshopId: string,
  ): Promise<{ checklist: ChecklistItem[]; items: ArtifactView[] }> {
    return auditedAsync(
      this.db,
      actor,
      "workshop.read.refused",
      "workshop",
      workshopId,
      async () => {
        requirePermission(actor, "workshops.read");
        workshopOr404(this.db.raw, workshopId);
        for (const a of listArtifacts(this.db.raw, workshopId)) await this.sync(actor, a);
        const rows = listArtifacts(this.db.raw, workshopId);
        return { checklist: artifactChecklist(this.d.settings.kinds, rows), items: rows.map(view) };
      },
    );
  }

  async content(
    actor: CatalogueActor,
    artifactId: string,
  ): Promise<{ text: string; fileName: string }> {
    return auditedAsync(
      this.db,
      actor,
      "workshop.artifact.read.refused",
      "workshop_artifact",
      artifactId,
      async () => {
        requirePermission(actor, "workshops.read");
        await this.sync(actor, this.artifactOr404(artifactId));
        const a = this.artifactOr404(artifactId);
        if (a.state === "held") {
          throw refuse(409, "held_for_review", "This file is held for review.");
        }
        if (a.state === "discarded") {
          throw refuse(409, "artifact_discarded", "This file was discarded.");
        }
        if (a.fileDeletedAt !== null) {
          throw refuse(410, "file_deleted", "This file was deleted when its retention ended.");
        }
        if (a.storageKey === null) {
          throw refuse(404, "no_content", "Only a reference was recorded.");
        }
        const file = await this.d.files.get(a.storageKey);
        if (!file) throw refuse(410, "file_deleted", "This file is no longer there.");
        const chunks: Buffer[] = [];
        for await (const chunk of file.stream) chunks.push(Buffer.from(chunk as Uint8Array));
        return { text: Buffer.concat(chunks).toString("utf8"), fileName: a.storageKey };
      },
    );
  }

  async decide(actor: CatalogueActor, artifactId: string, raw: unknown): Promise<ArtifactView> {
    return auditedAsync(
      this.db,
      actor,
      "workshop.artifact.decision.refused",
      "workshop_artifact",
      artifactId,
      async () => {
        requirePermission(actor, "quarantine.review");
        const input = parseOrThrow(ArtifactDecisionSchema, raw);
        guardFreeText({ reason: input.reason });
        const a = this.artifactOr404(artifactId);
        const itemId = a.quarantineItemId;
        if (a.state !== "held" || itemId === null) {
          throw refuse(409, "artifact_already_decided", "This artifact is not held.");
        }
        const item = this.d.quarantine.getMeta(itemId);
        const decider = {
          userId: actor.userId as string,
          actorType: actor.actorType,
          correlationId: actor.correlationId,
        };
        if (input.decision === "discard") {
          this.db.transaction((tx) => {
            if (item.status === "held") {
              this.d.quarantine.discard(tx, decider, itemId, input.reason);
            }
            this.discarded(tx, actor, a, actor.userId, nowOf(actor).toISOString());
          });
          return view(this.artifactOr404(artifactId));
        }
        if (item.status === "discarded") {
          throw refuse(409, "artifact_already_decided", "This content was discarded.");
        }
        if (item.contentPurged) {
          throw refuse(
            409,
            "content_purged",
            "The held content was purged when its holding period ended. It can only be discarded.",
          );
        }
        if (item.status === "held") {
          this.db.transaction((tx) => {
            this.d.quarantine.release(tx, decider, itemId, input.reason);
          });
        }
        const accepted = await this.accept(actor, a, actor.userId, nowOf(actor).toISOString());
        if (!accepted.ok) {
          throw refuse(
            409,
            "held_for_review",
            "The content was rechecked and is still held: a check other than the released ones matches, or the checks have changed.",
            accepted.ruleIds,
          );
        }
        return view(this.artifactOr404(artifactId));
      },
    );
  }

  // ---- inside -------------------------------------------------------------------------------------

  private artifactOr404(id: string): ArtifactRow {
    const a = getArtifact(this.db.raw, id);
    if (!a) throw refuse(404, "unknown_artifact", "No such artifact.");
    return a;
  }

  /** The upload boundary check. A guard that cannot run refuses the entry. */
  private check(content: string): GuardDecision {
    const onMatch = resolveGuardAction("upload", {
      quarantineEntryPoints: this.d.settings.uploadQuarantine ? ["upload"] : [],
    });
    try {
      // The file's size is already limited. The guard's budget counts structured text more than once (the
      // string, then what it encodes), so it gets room for that or a clean data file would be held.
      return this.guard(content, { onMatch, maxBytes: this.d.settings.maxBytes * 4 });
    } catch {
      throw refuse(
        422,
        "guard_unavailable",
        "The file could not be checked, so it was not accepted.",
      );
    }
  }

  private insert(actor: CatalogueActor, row: ArtifactRow): ArtifactView {
    return this.db.transaction((tx) => {
      insertArtifact(tx, row);
      auditChange(
        tx,
        actor,
        "workshop.artifact.record",
        { type: "workshop_artifact", id: row.id },
        { workshop_id: row.workshopId, kind: row.kind, has_content: row.storageKey !== null },
      );
      return view(row);
    });
  }

  private flagged(
    actor: CatalogueActor,
    base: ArtifactRow,
    content: string,
    decision: GuardDecision,
  ): ArtifactView {
    const block = {
      entryPoint: "upload",
      ruleIds: decision.rule_ids,
      guardVersion: decision.guard_version,
      correlationId: actor.correlationId,
      entityType: "workshop_artifact",
    };
    if (decision.decision !== "quarantine") {
      this.db.transaction((tx) =>
        recordPhiBlock(
          tx,
          this.d.notifier,
          { ...block, action: "reject", entityRef: base.workshopId },
          () => nowOf(actor),
        ),
      );
      throw refuse(
        422,
        "phi_guard",
        "The file looks as if it holds patient data or a credential. Nothing was kept.",
        decision.rule_ids,
      );
    }
    return this.db.transaction((tx) => {
      const quarantineItemId = this.d.quarantine.hold(tx, {
        entryPoint: "upload",
        content,
        ruleIds: decision.rule_ids,
        guardVersion: decision.guard_version,
      });
      const row: ArtifactRow = {
        ...base,
        state: "held",
        quarantineItemId,
        holdRuleIdsJson: JSON.stringify(decision.rule_ids),
      };
      insertArtifact(tx, row);
      recordPhiBlock(
        tx,
        this.d.notifier,
        { ...block, action: "quarantine", entityRef: row.id },
        () => nowOf(actor),
      );
      auditChange(
        tx,
        actor,
        "workshop.artifact.hold",
        { type: "workshop_artifact", id: row.id },
        { workshop_id: row.workshopId, kind: row.kind, rule_ids: decision.rule_ids },
      );
      return view(row);
    });
  }

  private async store(key: string, content: string): Promise<void> {
    const stored = await this.d.files.put(key, Buffer.from(content, "utf8"), "text/plain");
    if (!stored.ok) {
      throw refuse(503, "storage_failed", "The file could not be stored. Please try again.");
    }
  }

  private discarded(
    tx: Tx,
    actor: CatalogueActor,
    a: ArtifactRow,
    decidedBy: string | null,
    decidedAt: string,
  ): void {
    if (!decideArtifact(tx, a.id, { state: "discarded", decidedBy, decidedAt })) return;
    auditChange(
      tx,
      actor,
      "workshop.artifact.discard",
      { type: "workshop_artifact", id: a.id },
      { workshop_id: a.workshopId, decided_by: decidedBy },
    );
  }

  /**
   * Take released content once, but only if it passes the release rule: the guard is the version that held
   * it and every rule matching now is one the reviewer released. Otherwise the item stays unconsumed.
   */
  private async accept(
    actor: CatalogueActor,
    a: ArtifactRow,
    decidedBy: string | null,
    decidedAt: string,
  ): Promise<Acceptance> {
    const itemId = a.quarantineItemId as string;
    let content: string;
    try {
      this.db.transaction((tx) => {
        throw new Peek(this.d.quarantine.consumeRelease(tx, itemId).content);
      });
      return { ok: false, ruleIds: [] };
    } catch (error) {
      if (!(error instanceof Peek)) return { ok: false, ruleIds: [] };
      content = error.content;
    }
    const heldVersion = this.d.quarantine.getMeta(itemId).guardVersion;
    const released = new Set(view(a).holdRuleIds);
    const now = this.check(content);
    const others = now.rule_ids.filter((id) => !released.has(id));
    if (now.guard_version !== heldVersion || others.length > 0) {
      return { ok: false, ruleIds: others };
    }
    const key = `workshop-${a.workshopId}-${a.kind}-${a.id}.txt`;
    await this.store(key, content);
    try {
      this.db.transaction((tx) => {
        this.d.quarantine.consumeRelease(tx, itemId);
        const moved = decideArtifact(tx, a.id, {
          state: "released",
          storageKey: key,
          sizeBytes: Buffer.byteLength(content),
          contentSha256: sha256(content),
          decidedBy,
          decidedAt,
        });
        if (!moved) throw refuse(409, "artifact_already_decided", "This artifact is not held.");
        auditChange(
          tx,
          actor,
          "workshop.artifact.release",
          { type: "workshop_artifact", id: a.id },
          { workshop_id: a.workshopId, decided_by: decidedBy },
        );
      });
    } catch (error) {
      // Only remove a file nobody else's successful release now points at.
      if (getArtifact(this.db.raw, a.id)?.storageKey !== key) await this.d.files.delete(key);
      throw error;
    }
    return { ok: true };
  }

  /** A decision made on the general quarantine screen reaches the artifact when it is next read. */
  private async sync(actor: CatalogueActor, a: ArtifactRow): Promise<void> {
    if (a.state !== "held" || a.quarantineItemId === null) return;
    const item = this.d.quarantine.getMeta(a.quarantineItemId);
    if (item.status === "held") return;
    const decidedAt = item.decidedAt ?? nowOf(actor).toISOString();
    if (item.status === "discarded") {
      this.db.transaction((tx) => this.discarded(tx, actor, a, item.decidedBy, decidedAt));
      return;
    }
    if (item.contentPurged) return;
    try {
      await this.accept(actor, a, item.decidedBy, decidedAt);
    } catch (error) {
      // It stays held and is tried again on the next read.
      if (!(error instanceof CatalogueRefusal)) throw error;
    }
  }
}
