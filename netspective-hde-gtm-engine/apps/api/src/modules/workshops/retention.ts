import type { SqliteDatabase } from "@gtm/db";
import type { FileStorageProvider } from "@gtm/providers";
import { recordAudit } from "../audit/index.js";
import { expiredFiles, markFileDeleted } from "./repository.js";

// Retention of workshop files (feature 007, spec FR-038, research R-17; period a hypothesis). Artifact
// files and approved PDFs are deleted when their period ends; every record and the audit trail stay. A
// delete that fails is left unmarked and tried again on the next run.

export class WorkshopRetention {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly d: {
      files: FileStorageProvider;
      months: number;
      now?: (() => Date) | undefined;
    },
  ) {}

  async run(): Promise<{ deleted: number; failed: number }> {
    const now = (this.d.now ?? (() => new Date()))();
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - this.d.months);
    let deleted = 0;
    let failed = 0;
    for (const file of expiredFiles(this.db.raw, cutoff.toISOString())) {
      if (!(await this.d.files.delete(file.storageKey))) {
        failed += 1;
        continue;
      }
      this.db.transaction((tx) => {
        markFileDeleted(tx, file, now.toISOString());
        recordAudit(
          tx,
          {
            actorId: null,
            actorType: "system",
            action: "workshop.file.delete",
            entityType: file.table,
            entityId: file.id,
            outcome: "success",
            after: { workshop_id: file.workshopId, reason: "retention" },
          },
          () => now,
        );
      });
      deleted += 1;
    }
    return { deleted, failed };
  }
}
