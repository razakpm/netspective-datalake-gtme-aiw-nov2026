import type { SqliteDatabase } from "@gtm/db";
import { recordAudit } from "../audit/index.js";
import { HttpError } from "../../http/errors.js";
import type { ResearchService } from "./service.js";
import type { ResearchActor } from "./settings.js";
import { resolveAccountScope } from "../signals/index.js";

// The simple per-account repeat schedule (task T030; spec FR-008, research R-15). Only an analyst can create
// one for a chosen account; there is no path that schedules accounts nobody chose. The hourly `tick`
// starts a normal run (default budget, counted against the account cap) for each due, enabled schedule.

export interface ScheduleView {
  accountId: string;
  enabled: boolean;
  cadence: "weekly" | "monthly" | null;
  nextRunAt: string | null;
}

function advance(from: Date, cadence: "weekly" | "monthly"): Date {
  const d = new Date(from);
  if (cadence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export class ResearchSchedules {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly service: ResearchService,
  ) {}

  get(accountId: string): ScheduleView {
    const row = this.db.raw
      .prepare("SELECT * FROM research_schedule WHERE account_id = ?")
      .get(accountId) as
      | { account_id: string; cadence: "weekly" | "monthly"; next_run_at: string; enabled: number }
      | undefined;
    return row
      ? {
          accountId,
          enabled: row.enabled === 1,
          cadence: row.cadence,
          nextRunAt: row.enabled === 1 ? row.next_run_at : null,
        }
      : { accountId, enabled: false, cadence: null, nextRunAt: null };
  }

  set(
    actor: ResearchActor,
    accountId: string,
    input: { enabled: boolean; cadence?: "weekly" | "monthly" | undefined },
  ): ScheduleView {
    const now = actor.now ?? (() => new Date());
    this.db.transaction((tx) => {
      const scope = resolveAccountScope(tx, accountId);
      if (!scope) throw new HttpError(404, "Not found", "No such account");
      const existing = tx
        .prepare("SELECT cadence FROM research_schedule WHERE account_id = ?")
        .get(scope.survivor) as { cadence: "weekly" | "monthly" } | undefined;
      const cadence = input.cadence ?? existing?.cadence;
      if (input.enabled && !cadence)
        throw new HttpError(400, "Invalid schedule", "A cadence is required to turn a schedule on");
      const at = now();
      tx.prepare(
        `INSERT INTO research_schedule (account_id, cadence, next_run_at, enabled, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(account_id) DO UPDATE SET cadence = excluded.cadence, next_run_at = excluded.next_run_at,
           enabled = excluded.enabled, updated_at = excluded.updated_at`,
      ).run(
        scope.survivor,
        cadence ?? "weekly",
        advance(at, cadence ?? "weekly").toISOString(),
        input.enabled ? 1 : 0,
        actor.userId ?? "system",
        at.toISOString(),
        at.toISOString(),
      );
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "research.schedule.set",
          entityType: "research_schedule",
          entityId: scope.survivor,
          outcome: "success",
          after: { enabled: input.enabled, cadence: cadence ?? null },
          correlationId: actor.correlationId,
        },
        now,
      );
    });
    const scope = this.db.transaction((tx) => resolveAccountScope(tx, accountId))!;
    return this.get(scope.survivor);
  }

  /** Start a run for every due schedule. Returns the ids of runs started. */
  tick(now: Date = new Date()): string[] {
    const due = this.db.raw
      .prepare(
        "SELECT account_id, cadence, created_by FROM research_schedule WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at",
      )
      .all(now.toISOString()) as {
      account_id: string;
      cadence: "weekly" | "monthly";
      created_by: string;
    }[];
    const started: string[] = [];
    for (const s of due) {
      try {
        const run = this.service.startRun(
          { userId: s.created_by, actorType: "system", correlationId: null, now: () => now },
          s.account_id,
          {},
          "schedule",
        );
        started.push(run.id);
      } catch {
        // An active run, the account cap or a missing source skips this cycle; the refusal is audited.
      }
      this.db.raw
        .prepare(
          "UPDATE research_schedule SET next_run_at = ?, updated_at = ? WHERE account_id = ?",
        )
        .run(advance(now, s.cadence).toISOString(), now.toISOString(), s.account_id);
    }
    return started;
  }
}
