import type { SqliteDatabase } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { parseOrThrow } from "../../http/errors.js";
import {
  audited,
  CatalogueRefusal,
  guardFreeText,
  holds,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { recordAudit } from "../audit/index.js";

// Notice and consent wording versions (feature 006, spec FR-017, research R-09). The text of a version never
// changes; a new row is a new version. A version is shown by a form only once someone other than its author
// has approved it, and nothing is seeded: the wording comes from the marketing approver (open question #51).

export const NoticeInputSchema = z
  .object({
    noticeText: z.string().min(20).max(4000),
    consentText: z.string().min(10).max(600),
  })
  .strict();

export interface NoticeView {
  id: string;
  version: number;
  noticeText: string;
  consentText: string;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

interface Row {
  id: string;
  version: number;
  notice_text: string;
  consent_text: string;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
}
const toView = (r: Row): NoticeView => ({
  id: r.id,
  version: r.version,
  noticeText: r.notice_text,
  consentText: r.consent_text,
  createdBy: r.created_by,
  createdAt: r.created_at,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
});

export class NoticeService {
  constructor(private readonly db: SqliteDatabase) {}

  /** The latest approved version, or null: with none, no form is shown. */
  currentApproved(): NoticeView | null {
    const r = this.db.raw
      .prepare(
        "SELECT * FROM notice_version WHERE approved_by IS NOT NULL ORDER BY version DESC LIMIT 1",
      )
      .get() as Row | undefined;
    return r ? toView(r) : null;
  }

  /** An approved version by id: a version shown to a visitor stays acceptable while it is approved. */
  approvedById(id: string): NoticeView | null {
    const r = this.db.raw
      .prepare("SELECT * FROM notice_version WHERE id = ? AND approved_by IS NOT NULL")
      .get(id) as Row | undefined;
    return r ? toView(r) : null;
  }

  list(actor: CatalogueActor): NoticeView[] {
    return audited(this.db, actor, "notice.read.refused", "notice_version", null, () => {
      if (!holds(actor, "notices.manage") && !holds(actor, "notices.approve")) {
        requirePermission(actor, "notices.manage");
      }
      return (
        this.db.raw
          .prepare("SELECT * FROM notice_version ORDER BY version DESC")
          .all() as unknown as Row[]
      ).map(toView);
    });
  }

  create(actor: CatalogueActor, raw: unknown): NoticeView {
    const input = parseOrThrow(NoticeInputSchema, raw);
    return audited(this.db, actor, "notice.create.refused", "notice_version", null, () => {
      requirePermission(actor, "notices.manage");
      guardFreeText({ noticeText: input.noticeText, consentText: input.consentText });
      const id = uuidv7();
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        const next =
          (
            tx.prepare("SELECT COALESCE(MAX(version), 0) v FROM notice_version").get() as {
              v: number;
            }
          ).v + 1;
        tx.prepare(
          "INSERT INTO notice_version (id, version, notice_text, consent_text, created_by, created_at) VALUES (?,?,?,?,?,?)",
        ).run(id, next, input.noticeText, input.consentText, actor.userId as string, at);
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "notice.create",
            entityType: "notice_version",
            entityId: id,
            outcome: "success",
            after: { version: next },
            correlationId: actor.correlationId,
          },
          actor.now,
        );
        return toView(
          tx.prepare("SELECT * FROM notice_version WHERE id = ?").get(id) as unknown as Row,
        );
      });
    });
  }

  approve(actor: CatalogueActor, id: string): NoticeView {
    return audited(this.db, actor, "notice.approve.refused", "notice_version", id, () => {
      requirePermission(actor, "notices.approve");
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        const row = tx.prepare("SELECT * FROM notice_version WHERE id = ?").get(id) as
          Row | undefined;
        if (!row) throw new CatalogueRefusal(404, "Not found", ["unknown_notice_version"]);
        if (row.approved_by !== null)
          throw new CatalogueRefusal(409, "Conflict", ["already_approved"]);
        if (row.created_by === actor.userId) {
          throw new CatalogueRefusal(
            409,
            "Conflict",
            ["author_cannot_approve"],
            [],
            "The author of a notice version cannot approve it.",
          );
        }
        tx.prepare("UPDATE notice_version SET approved_by = ?, approved_at = ? WHERE id = ?").run(
          actor.userId as string,
          at,
          id,
        );
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "notice.approve",
            entityType: "notice_version",
            entityId: id,
            outcome: "success",
            after: { version: row.version },
            correlationId: actor.correlationId,
          },
          actor.now,
        );
        return toView(
          tx.prepare("SELECT * FROM notice_version WHERE id = ?").get(id) as unknown as Row,
        );
      });
    });
  }
}
