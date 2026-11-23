import type { SqliteDatabase } from "@gtm/db";
import { parseRuleSet, ROUTING_CORPUS, runCorpus, type RuleSet, type Corpus } from "@gtm/domain";
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

// Routing rule set versions (feature 006, spec FR-009, FR-013, research R-07). A version is immutable data;
// only its state moves draft -> active -> retired. Activation needs `routing.rules.manage`, a reason and a
// passing run of the packaged case corpus. Activation is a policy change and is audited.

export const DraftInputSchema = z
  .object({ rules: z.unknown(), reason: z.string().min(3).max(300) })
  .strict();
export const ActivateInputSchema = z.object({ reason: z.string().min(3).max(300) }).strict();

export interface RuleSetRow {
  version: number;
  state: "draft" | "active" | "retired";
  author: string;
  reason: string;
  createdAt: string;
  activatedBy: string | null;
  activatedAt: string | null;
  testsPassedAt: string | null;
}
export interface RuleSetView extends RuleSetRow {
  rules: RuleSet;
}

interface Raw {
  version: number;
  rules_json: string;
  state: "draft" | "active" | "retired";
  author: string;
  reason: string;
  created_at: string;
  activated_by: string | null;
  activated_at: string | null;
  tests_passed_at: string | null;
}
const toView = (r: Raw): RuleSetView => ({
  version: r.version,
  state: r.state,
  author: r.author,
  reason: r.reason,
  createdAt: r.created_at,
  activatedBy: r.activated_by,
  activatedAt: r.activated_at,
  testsPassedAt: r.tests_passed_at,
  rules: JSON.parse(r.rules_json) as RuleSet,
});

export class RuleSetService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly corpus: Corpus = ROUTING_CORPUS,
  ) {}

  /** The one active version. Throws when none exists (the seed always creates version 1). */
  active(): RuleSetView {
    const row = this.db.raw
      .prepare("SELECT * FROM routing_rule_set WHERE state = 'active'")
      .get() as Raw | undefined;
    if (!row) throw new HttpError(503, "No routing rule set is active");
    return toView(row);
  }

  byVersion(version: number): RuleSetView | null {
    const row = this.db.raw
      .prepare("SELECT * FROM routing_rule_set WHERE version = ?")
      .get(version) as Raw | undefined;
    return row ? toView(row) : null;
  }

  list(actor: CatalogueActor): RuleSetView[] {
    return audited(this.db, actor, "routing.rules.read.refused", "routing_rule_set", null, () => {
      requirePermission(actor, "offers.read");
      return (
        this.db.raw
          .prepare("SELECT * FROM routing_rule_set ORDER BY version DESC")
          .all() as unknown as Raw[]
      ).map(toView);
    });
  }

  get(actor: CatalogueActor, version: number): RuleSetView {
    return audited(
      this.db,
      actor,
      "routing.rules.read.refused",
      "routing_rule_set",
      String(version),
      () => {
        requirePermission(actor, "offers.read");
        const v = this.byVersion(version);
        if (!v) throw new CatalogueRefusal(404, "Not found", ["unknown_rule_set"]);
        return v;
      },
    );
  }

  createDraft(actor: CatalogueActor, raw: unknown): RuleSetView {
    const input = parseOrThrow(DraftInputSchema, raw);
    return audited(this.db, actor, "routing.rules.create.refused", "routing_rule_set", null, () => {
      requirePermission(actor, "routing.rules.manage");
      guardFreeText({ reason: input.reason });
      const parsed = parseRuleSet(input.rules);
      if (!parsed.ok) throw new CatalogueRefusal(422, "Rule set refused", ["rules_invalid"]);
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        const next =
          (
            tx.prepare("SELECT COALESCE(MAX(version), 0) v FROM routing_rule_set").get() as {
              v: number;
            }
          ).v + 1;
        tx.prepare(
          "INSERT INTO routing_rule_set (version, rules_json, state, author, reason, created_at) VALUES (?,?,'draft',?,?,?)",
        ).run(next, JSON.stringify(parsed.set), actor.userId as string, input.reason, at);
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "routing.rules.create",
            entityType: "routing_rule_set",
            entityId: String(next),
            outcome: "success",
            after: { version: next },
            correlationId: actor.correlationId,
          },
          actor.now,
        );
        return toView(
          tx
            .prepare("SELECT * FROM routing_rule_set WHERE version = ?")
            .get(next) as unknown as Raw,
        );
      });
    });
  }

  /** The case ids that fail for a rule set (empty when it passes). */
  failures(rules: RuleSet, version: number): string[] {
    return runCorpus(rules, version, this.corpus).failures.map((f) => f.split(":")[0] ?? f);
  }

  activate(actor: CatalogueActor, version: number, raw: unknown): RuleSetView {
    const input = parseOrThrow(ActivateInputSchema, raw);
    return audited(
      this.db,
      actor,
      "routing.rules.activate.refused",
      "routing_rule_set",
      String(version),
      () => {
        requirePermission(actor, "routing.rules.manage");
        guardFreeText({ reason: input.reason });
        const target = this.byVersion(version);
        if (!target) throw new CatalogueRefusal(404, "Not found", ["unknown_rule_set"]);
        if (target.state !== "draft") {
          throw new CatalogueRefusal(409, "Conflict", ["not_a_draft"]);
        }
        const parsed = parseRuleSet(target.rules);
        if (!parsed.ok) throw new CatalogueRefusal(422, "Rule set refused", ["rules_invalid"]);
        const failing = this.failures(parsed.set, version);
        if (failing.length > 0) {
          throw new CatalogueRefusal(
            422,
            "Rule set refused",
            ["rules_tests_failed"],
            [],
            `The case corpus fails for: ${failing.slice(0, 20).join(", ")}`,
          );
        }
        const at = nowOf(actor).toISOString();
        return this.db.transaction((tx) => {
          const previous = tx
            .prepare("SELECT version FROM routing_rule_set WHERE state = 'active'")
            .get() as { version: number } | undefined;
          if (previous) {
            tx.prepare("UPDATE routing_rule_set SET state = 'retired' WHERE version = ?").run(
              previous.version,
            );
          }
          tx.prepare(
            "UPDATE routing_rule_set SET state = 'active', activated_by = ?, activated_at = ?, tests_passed_at = ? WHERE version = ?",
          ).run(actor.userId as string, at, at, version);
          recordAudit(
            tx,
            {
              actorId: actor.userId,
              actorType: actor.actorType,
              action: "routing.rules.activate",
              entityType: "routing_rule_set",
              entityId: String(version),
              outcome: "success",
              before: { active_version: previous?.version ?? null },
              after: { active_version: version, reason_length: input.reason.length },
              correlationId: actor.correlationId,
            },
            actor.now,
          );
          return toView(
            tx
              .prepare("SELECT * FROM routing_rule_set WHERE version = ?")
              .get(version) as unknown as Raw,
          );
        });
      },
    );
  }
}
