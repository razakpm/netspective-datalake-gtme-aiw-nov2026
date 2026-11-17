import type { SqliteDatabase } from "@gtm/db";
import { recordAudit } from "../audit/index.js";

// Removes job payloads and error details a set time after a job reaches a terminal state, keeping the
// job's metadata (task T079, spec FR-053, SC-014). The idempotency key stays, so a purged job's key
// cannot be reused for different work. Non-terminal jobs are never touched.

export function purgeJobDetails(
  db: SqliteDatabase,
  options: { olderThanDays: number; now?: () => Date },
): { purged: number } {
  const now = options.now ?? (() => new Date());
  const cutoff = new Date(now().getTime() - options.olderThanDays * 86_400_000).toISOString();
  return db.transaction((tx) => {
    const result = tx
      .prepare(
        `UPDATE job SET payload = NULL, last_error = NULL
         WHERE state IN ('succeeded','failed') AND finished_at <= ?
           AND (payload IS NOT NULL OR last_error IS NOT NULL)`,
      )
      .run(cutoff);
    const purged = Number(result.changes);
    recordAudit(
      tx,
      {
        actorId: null,
        actorType: "system",
        action: "job.details.purged",
        entityType: "job",
        outcome: "success",
        after: { count: purged },
      },
      now,
    );
    return { purged };
  });
}
