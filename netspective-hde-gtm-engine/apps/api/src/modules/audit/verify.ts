import type { SqliteDatabase } from "@gtm/db";
import { verifyChain, type ChainRow, type ChainVerification } from "@gtm/domain";

// Walks the whole chain (task T057). After a retention drop the first remaining row must link to the
// last removed hash recorded by the latest retention event, so removal of rows outside retention shows up.

export function verifyAuditChain(db: SqliteDatabase): ChainVerification {
  const rows = db.raw
    .prepare("SELECT * FROM audit_event ORDER BY rowid")
    .all() as unknown as ChainRow[];
  return verifyChain(rows, { anchorPrevHash: latestRetentionAnchor(db) });
}

export function latestRetentionAnchor(db: SqliteDatabase): string | null {
  const row = db.raw
    .prepare(
      "SELECT after_summary FROM audit_event WHERE action = 'audit.retention.dropped' ORDER BY rowid DESC LIMIT 1",
    )
    .get() as { after_summary: string | null } | undefined;
  if (!row?.after_summary) return null;
  const parsed = JSON.parse(row.after_summary) as { lastDroppedHash?: string };
  return parsed.lastDroppedHash ?? null;
}
