import type { SqliteDatabase } from "@gtm/db";
import { recordAudit } from "./writer.js";

// Audited retention (task T058, spec FR-012, FR-053). Audit events are removed only as a whole calendar
// period (UTC month), oldest first, by this privileged maintenance operation, which records what it
// dropped. Postgres drops whole partitions instead (R-11).

export const DEFAULT_MINIMUM_RETENTION_MONTHS = 84; // 7 years (open question #17)

export class RetentionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetentionRefusedError";
  }
}

export interface RetentionOptions {
  retentionMonths: number;
  /** Shortest period the command accepts. Configured, defaults to 7 years. */
  minimumMonths?: number;
  now?: () => Date;
}

export interface DroppedPeriod {
  period: string;
  rowCount: number;
  lastDroppedHash: string;
}

function assertAllowed(options: RetentionOptions): void {
  const minimum = options.minimumMonths ?? DEFAULT_MINIMUM_RETENTION_MONTHS;
  if (!Number.isInteger(options.retentionMonths) || options.retentionMonths < minimum) {
    throw new RetentionRefusedError(
      `retention period is shorter than the minimum of ${minimum} months`,
    );
  }
}

function periodBounds(period: string): { start: string; end: string } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new RetentionRefusedError("period must look like YYYY-MM");
  const year = Number(match[1]);
  const month = Number(match[2]);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    end: new Date(Date.UTC(year, month, 1)).toISOString(),
  };
}

function cutoff(options: RetentionOptions): string {
  const now = (options.now ?? (() => new Date()))();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - options.retentionMonths, now.getUTCDate()),
  ).toISOString();
}

export function dropAuditPeriod(
  db: SqliteDatabase,
  period: string,
  options: RetentionOptions,
): DroppedPeriod {
  assertAllowed(options);
  const { start, end } = periodBounds(period);
  if (end > cutoff(options)) {
    throw new RetentionRefusedError("period is inside the retention window and cannot be dropped");
  }
  return db.transaction((tx) => {
    const oldest = tx.prepare("SELECT min(occurred_at) m FROM audit_event").get() as {
      m: string | null;
    };
    if (!oldest.m || oldest.m >= end) throw new RetentionRefusedError("period has no audit events");
    if (oldest.m < start) throw new RetentionRefusedError("only the oldest period can be dropped");

    const last = tx
      .prepare(
        "SELECT row_hash FROM audit_event WHERE occurred_at >= ? AND occurred_at < ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(start, end) as { row_hash: string };
    const { c } = tx
      .prepare("SELECT count(*) c FROM audit_event WHERE occurred_at >= ? AND occurred_at < ?")
      .get(start, end) as { c: number };

    tx.prepare("INSERT INTO audit_retention_window (start_at, end_at) VALUES (?, ?)").run(
      start,
      end,
    );
    tx.prepare("DELETE FROM audit_event WHERE occurred_at >= ? AND occurred_at < ?").run(
      start,
      end,
    );
    tx.prepare("DELETE FROM audit_retention_window").run();

    recordAudit(
      tx,
      {
        actorId: null,
        actorType: "system",
        action: "audit.retention.dropped",
        entityType: "audit_period",
        entityId: period,
        outcome: "success",
        after: { period, rowCount: c, lastDroppedHash: last.row_hash },
      },
      options.now,
    );
    return { period, rowCount: c, lastDroppedHash: last.row_hash };
  });
}

/** Drop every expired period, oldest first. Nothing expired means no change and no event. */
export function dropExpiredAuditPeriods(
  db: SqliteDatabase,
  options: RetentionOptions,
): DroppedPeriod[] {
  assertAllowed(options);
  const limit = cutoff(options);
  const dropped: DroppedPeriod[] = [];
  for (;;) {
    const oldest = db.raw.prepare("SELECT min(occurred_at) m FROM audit_event").get() as {
      m: string | null;
    };
    if (!oldest.m) break;
    const date = new Date(oldest.m);
    const period = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (periodBounds(period).end > limit) break;
    dropped.push(dropAuditPeriod(db, period, options));
  }
  return dropped;
}
