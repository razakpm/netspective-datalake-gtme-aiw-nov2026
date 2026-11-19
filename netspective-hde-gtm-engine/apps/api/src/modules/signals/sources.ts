import type { SqliteDatabase } from "@gtm/db";
import {
  guardValue,
  SEED_SIGNAL_TYPES,
  SOURCE_KINDS,
  SOURCE_KIND_RELIABILITY,
  type SignalTypeDefinition,
  type SourceKind,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit/index.js";
import { SignalRefusal, auditedRefusals, type SignalActor } from "./actor.js";
import { appendProvenance, getSource, type SourceRow } from "./repository.js";

// Source registry and taxonomy publication (tasks T023, T073; spec FR-004, FR-019, FR-031). A source may
// set an excerpt limit shorter than the global ceiling, never longer; citation-only sources hold none.

export interface SourceView {
  id: string;
  name: string;
  kind: string;
  defaultReliability: string;
  storageRule: string;
  excerptMaxChars: number | null;
  availability: string;
  unavailableSince: string | null;
  statusLabel: string;
}

const view = (r: SourceRow): SourceView => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  defaultReliability: r.default_reliability,
  storageRule: r.storage_rule,
  excerptMaxChars: r.excerpt_max_chars,
  availability: r.availability,
  unavailableSince: r.unavailable_since,
  statusLabel: r.status_label,
});

export interface SourceInput {
  name: string;
  kind: SourceKind;
  defaultReliability?: "high" | "medium" | "low" | "unknown" | undefined;
  storageRule?: "excerpt" | "citation_only" | undefined;
  excerptMaxChars?: number | null | undefined;
}

export class SourceService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly excerptCeiling: number,
  ) {}

  list(): SourceView[] {
    return (
      this.db.raw
        .prepare("SELECT * FROM signal_source ORDER BY name")
        .all() as unknown as SourceRow[]
    ).map(view);
  }

  listTypes(version?: number) {
    const v =
      version ??
      (
        this.db.raw
          .prepare("SELECT version FROM taxonomy_version WHERE status = 'current'")
          .get() as {
          version: number;
        }
      ).version;
    const head = this.db.raw
      .prepare("SELECT version, status, status_label FROM taxonomy_version WHERE version = ?")
      .get(v) as { version: number; status: string; status_label: string } | undefined;
    if (!head) throw new SignalRefusal(404, "Not found", ["unknown_taxonomy_version"]);
    const types = this.db.raw
      .prepare("SELECT * FROM signal_type WHERE taxonomy_version = ? ORDER BY category, key")
      .all(v) as Record<string, string | number>[];
    return {
      version: head.version,
      status: head.status,
      items: types.map((t) => ({
        key: t["key"],
        category: t["category"],
        label: t["label"],
        kind: t["kind"],
        defaultFreshnessDays: t["default_freshness_days"],
        defaultReliability: t["default_reliability"],
        contextOnly: t["context_only"] === 1,
        status: t["status"],
        statusLabel: t["status_label"],
      })),
    };
  }

  private checkLimit(input: { storageRule: string; excerptMaxChars: number | null }): void {
    if (input.storageRule === "citation_only" && (input.excerptMaxChars ?? 0) > 0) {
      throw new SignalRefusal(422, "Source refused", ["citation_only_has_no_excerpt_limit"]);
    }
    if (input.excerptMaxChars !== null && input.excerptMaxChars > this.excerptCeiling) {
      throw new SignalRefusal(422, "Source refused", ["excerpt_limit_above_global_ceiling"]);
    }
  }

  create(actor: SignalActor, input: SourceInput): SourceView {
    const now = actor.now ?? (() => new Date());
    return auditedRefusals(this.db, actor, "signal.source.refused", "signal_source", null, () => {
      const guard = guardValue({ name: input.name });
      if (guard.decision !== "allow") {
        throw new SignalRefusal(422, "Source refused", ["phi_guard"], guard.rule_ids);
      }
      if (!SOURCE_KINDS.includes(input.kind)) {
        throw new SignalRefusal(422, "Source refused", ["invalid_kind"]);
      }
      const storageRule = input.storageRule ?? "citation_only";
      const limit = input.excerptMaxChars ?? null;
      this.checkLimit({ storageRule, excerptMaxChars: limit });
      return this.db.transaction((tx) => {
        const dup = tx.prepare("SELECT 1 FROM signal_source WHERE name = ?").get(input.name.trim());
        if (dup) throw new SignalRefusal(409, "Source refused", ["source_name_exists"]);
        const id = uuidv7();
        tx.prepare(
          `INSERT INTO signal_source (id, name, kind, default_reliability, storage_rule, excerpt_max_chars,
             availability, created_by, created_at, status_label)
           VALUES (?,?,?,?,?,?, 'available', ?, ?, 'hypothesis')`,
        ).run(
          id,
          input.name.trim(),
          input.kind,
          input.defaultReliability ?? SOURCE_KIND_RELIABILITY[input.kind],
          storageRule,
          limit,
          actor.userId,
          now().toISOString(),
        );
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "signal.source.create",
            entityType: "signal_source",
            entityId: id,
            outcome: "success",
            after: { kind: input.kind, storage_rule: storageRule },
            correlationId: actor.correlationId,
          },
          now,
        );
        return view(getSource(tx, id)!);
      });
    });
  }

  update(
    actor: SignalActor,
    id: string,
    patch: Partial<Omit<SourceInput, "name" | "kind">>,
  ): SourceView {
    const now = actor.now ?? (() => new Date());
    return auditedRefusals(this.db, actor, "signal.source.refused", "signal_source", id, () =>
      this.db.transaction((tx) => {
        const src = getSource(tx, id);
        if (!src) throw new SignalRefusal(404, "Not found", ["unknown_source"]);
        const storageRule = patch.storageRule ?? src.storage_rule;
        let limit =
          patch.excerptMaxChars !== undefined ? patch.excerptMaxChars : src.excerpt_max_chars;
        if (storageRule === "citation_only") limit = null;
        this.checkLimit({ storageRule, excerptMaxChars: limit ?? null });
        tx.prepare(
          "UPDATE signal_source SET default_reliability = ?, storage_rule = ?, excerpt_max_chars = ? WHERE id = ?",
        ).run(patch.defaultReliability ?? src.default_reliability, storageRule, limit ?? null, id);
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "signal.source.update",
            entityType: "signal_source",
            entityId: id,
            outcome: "success",
            before: { storage_rule: src.storage_rule, excerpt_max_chars: src.excerpt_max_chars },
            after: { storage_rule: storageRule, excerpt_max_chars: limit ?? null },
            correlationId: actor.correlationId,
          },
          now,
        );
        return view(getSource(tx, id)!);
      }),
    );
  }

  /** Mark a source unavailable or available again. Signals are kept and their reliability is untouched. */
  setAvailability(actor: SignalActor, id: string, available: boolean): SourceView {
    const now = actor.now ?? (() => new Date());
    return auditedRefusals(this.db, actor, "signal.source.refused", "signal_source", id, () =>
      this.db.transaction((tx) => {
        const src = getSource(tx, id);
        if (!src) throw new SignalRefusal(404, "Not found", ["unknown_source"]);
        if ((src.availability === "available") === available) return view(src);
        const at = now().toISOString();
        tx.prepare(
          "UPDATE signal_source SET availability = ?, unavailable_since = ? WHERE id = ?",
        ).run(available ? "available" : "unavailable", available ? null : at, id);
        if (!available) {
          const signals = tx.prepare("SELECT id FROM signal WHERE source_id = ?").all(id) as {
            id: string;
          }[];
          for (const s of signals) {
            appendProvenance(tx, s.id, {
              kind: "source_unavailable",
              actorId: actor.userId,
              actorType: actor.actorType,
              sourceId: id,
              detail: {},
              at,
            });
          }
        }
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "signal.source.unavailable",
            entityType: "signal_source",
            entityId: id,
            outcome: "success",
            after: { available },
            correlationId: actor.correlationId,
          },
          now,
        );
        return view(getSource(tx, id)!);
      }),
    );
  }

  /** Publish taxonomy version N+1 (admin): the old version becomes retired; old signals keep theirs. */
  publishTaxonomyVersion(
    actor: SignalActor,
    types: readonly SignalTypeDefinition[] = SEED_SIGNAL_TYPES,
    note = "Published by an administrator",
  ): number {
    const now = actor.now ?? (() => new Date());
    return this.db.transaction((tx) => {
      const cur = tx
        .prepare("SELECT version FROM taxonomy_version WHERE status = 'current'")
        .get() as {
        version: number;
      };
      const next = cur.version + 1;
      tx.prepare("UPDATE taxonomy_version SET status = 'retired' WHERE version = ?").run(
        cur.version,
      );
      tx.prepare(
        "INSERT INTO taxonomy_version (version, status, released_at, approved_by, note, status_label) VALUES (?, 'current', ?, ?, ?, 'hypothesis')",
      ).run(next, now().toISOString(), actor.userId, note);
      const insert = tx.prepare(
        `INSERT INTO signal_type (taxonomy_version, key, category, label, kind, default_freshness_days,
           default_reliability, context_only, status, status_label)
         VALUES (?,?,?,?,?,?,?,?, 'active', 'hypothesis')`,
      );
      for (const t of types) {
        insert.run(
          next,
          t.key,
          t.category,
          t.label,
          t.kind,
          t.defaultFreshnessDays,
          t.defaultReliability,
          t.contextOnly ? 1 : 0,
        );
      }
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "signal.taxonomy.publish",
          entityType: "taxonomy_version",
          entityId: String(next),
          outcome: "success",
          after: { version: next, types: types.length },
          correlationId: actor.correlationId,
        },
        now,
      );
      return next;
    });
  }
}
