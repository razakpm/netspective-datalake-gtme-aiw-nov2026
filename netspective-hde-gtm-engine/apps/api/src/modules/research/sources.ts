import type { SqliteDatabase } from "@gtm/db";
import { guardValue } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { HttpError } from "../../http/errors.js";
import { recordAudit } from "../audit/index.js";
import type { RuleRow } from "./repository.js";
import type { ResearchActor } from "./settings.js";

// The approved research source list (task T026; spec FR-002, FR-037). Rules are never deleted, only
// disabled; the kind decides the feature 003 source kind used for signals created from the source.

export const RULE_KINDS = [
  "analyst_capture",
  "public_org_site",
  "public_regulatory",
  "public_procurement",
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

const SIGNAL_KIND: Record<RuleKind, string> = {
  analyst_capture: "analyst_observation",
  public_org_site: "official_publication",
  public_regulatory: "official_publication",
  public_procurement: "official_publication",
};

export interface RuleView {
  id: string;
  kind: string;
  matchType: string;
  pattern: string;
  status: string;
  statusLabel: string;
}
const view = (r: RuleRow): RuleView => ({
  id: r.id,
  kind: r.kind,
  matchType: r.match_type,
  pattern: r.pattern,
  status: r.status,
  statusLabel: r.status_label,
});

export class ResearchSourceRules {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly webFetchEnabled: boolean,
  ) {}

  list(): { webFetchEnabled: boolean; items: RuleView[] } {
    const rows = this.db.raw
      .prepare("SELECT * FROM research_source_rule ORDER BY pattern")
      .all() as unknown as RuleRow[];
    return { webFetchEnabled: this.webFetchEnabled, items: rows.map(view) };
  }

  create(
    actor: ResearchActor,
    input: { kind: RuleKind; matchType: "host" | "host_suffix"; pattern: string },
  ): RuleView {
    const now = actor.now ?? (() => new Date());
    const pattern = input.pattern.trim().toLowerCase();
    if (!RULE_KINDS.includes(input.kind))
      throw new HttpError(400, "Invalid rule", "Unknown source kind");
    if (!/^[a-z0-9.-]{3,253}$/.test(pattern) || pattern.startsWith(".") || pattern.includes("..")) {
      throw new HttpError(400, "Invalid rule", "The pattern must be a host name");
    }
    const guard = guardValue({ pattern });
    if (guard.decision !== "allow")
      throw new HttpError(
        422,
        "Rule refused",
        `Rejected by the PHI boundary guard (${guard.rule_ids.join(", ")})`,
        { ruleIds: guard.rule_ids },
      );
    return this.db.transaction((tx) => {
      const dup = tx
        .prepare("SELECT 1 FROM research_source_rule WHERE match_type = ? AND pattern = ?")
        .get(input.matchType, pattern);
      if (dup) throw new HttpError(409, "Conflict", "This source pattern already exists");
      const id = uuidv7();
      tx.prepare(
        `INSERT INTO research_source_rule (id, kind, match_type, pattern, status, signal_source_kind, created_by, created_at, status_label)
         VALUES (?,?,?,?, 'enabled', ?, ?, ?, 'hypothesis')`,
      ).run(
        id,
        input.kind,
        input.matchType,
        pattern,
        SIGNAL_KIND[input.kind],
        actor.userId,
        now().toISOString(),
      );
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "research.source.rule.create",
          entityType: "research_source_rule",
          entityId: id,
          outcome: "success",
          after: { kind: input.kind, match_type: input.matchType },
          correlationId: actor.correlationId,
        },
        now,
      );
      return view(
        tx.prepare("SELECT * FROM research_source_rule WHERE id = ?").get(id) as unknown as RuleRow,
      );
    });
  }

  setStatus(actor: ResearchActor, id: string, status: "enabled" | "disabled"): RuleView {
    const now = actor.now ?? (() => new Date());
    return this.db.transaction((tx) => {
      const row = tx.prepare("SELECT * FROM research_source_rule WHERE id = ?").get(id) as
        RuleRow | undefined;
      if (!row) throw new HttpError(404, "Not found", "No such source rule");
      tx.prepare("UPDATE research_source_rule SET status = ? WHERE id = ?").run(status, id);
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "research.source.rule.update",
          entityType: "research_source_rule",
          entityId: id,
          outcome: "success",
          before: { status: row.status },
          after: { status },
          correlationId: actor.correlationId,
        },
        now,
      );
      return view({ ...row, status });
    });
  }
}
