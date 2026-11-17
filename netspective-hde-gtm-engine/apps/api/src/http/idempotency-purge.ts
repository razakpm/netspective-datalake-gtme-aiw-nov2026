import type { SqliteDatabase } from "@gtm/db";
import { recordAudit } from "../modules/audit/index.js";

// Removes expired idempotency records (task T080, spec FR-053, FR-055, SC-014). The period itself is the
// record's `expires_at` (24 hours by default, from configuration). After removal the key can be reused.

export function purgeExpiredIdempotency(
  db: SqliteDatabase,
  options: { now?: () => Date } = {},
): { purged: number } {
  const now = options.now ?? (() => new Date());
  return db.transaction((tx) => {
    const result = tx
      .prepare("DELETE FROM idempotency_record WHERE expires_at <= ?")
      .run(now().toISOString());
    const purged = Number(result.changes);
    recordAudit(
      tx,
      {
        actorId: null,
        actorType: "system",
        action: "idempotency.purged",
        entityType: "idempotency_record",
        outcome: "success",
        after: { count: purged },
      },
      now,
    );
    return { purged };
  });
}
