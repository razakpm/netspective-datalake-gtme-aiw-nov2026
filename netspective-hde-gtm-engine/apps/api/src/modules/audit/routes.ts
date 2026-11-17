import type { SqliteDatabase } from "@gtm/db";
import { guardValue } from "@gtm/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";

// GET /api/v1/audit-events (task T059, contracts/audit.openapi.yaml). Read-only; requires audit.read.

const QuerySchema = z.object({
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(200).optional(),
  actorId: z.string().max(200).optional(),
  correlationId: z.string().max(64).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: z
    .string()
    .regex(/^\d{1,15}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

interface Row {
  seq: number;
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  outcome: string;
  before_summary: string | null;
  after_summary: string | null;
  correlation_id: string | null;
}

/** Summaries were redacted at write time; the guard checks them again before they leave the API. */
function summaryOut(text: string | null): unknown {
  if (text === null) return null;
  const value: unknown = JSON.parse(text);
  const decision = guardValue(value);
  return decision.decision === "allow" ? value : { withheld: true, rule_ids: decision.rule_ids };
}

export function registerAuditRoutes(
  app: FastifyInstance,
  deps: { db: SqliteDatabase; authz: Authz },
): void {
  app.get(
    "/api/v1/audit-events",
    { preHandler: [deps.authz.authenticate, deps.authz.requirePermission("audit.read")] },
    async (request) => {
      const q = parseOrThrow(QuerySchema, request.query);
      const rows = deps.db.raw
        .prepare(
          `SELECT rowid AS seq, * FROM audit_event
           WHERE (?1 IS NULL OR entity_type = ?1)
             AND (?2 IS NULL OR entity_id = ?2)
             AND (?3 IS NULL OR actor_id = ?3)
             AND (?4 IS NULL OR correlation_id = ?4)
             AND (?5 IS NULL OR occurred_at >= ?5)
             AND (?6 IS NULL OR occurred_at < ?6)
             AND (?7 IS NULL OR rowid < ?7)
           ORDER BY rowid DESC LIMIT ?8`,
        )
        .all(
          q.entityType ?? null,
          q.entityId ?? null,
          q.actorId ?? null,
          q.correlationId ?? null,
          q.from ? new Date(q.from).toISOString() : null,
          q.to ? new Date(q.to).toISOString() : null,
          q.cursor ? Number(q.cursor) : null,
          q.limit + 1,
        ) as unknown as Row[];
      const page = rows.slice(0, q.limit);
      return {
        items: page.map((r) => ({
          id: r.id,
          occurredAt: r.occurred_at,
          actorId: r.actor_id,
          actorType: r.actor_type,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          outcome: r.outcome,
          beforeSummary: summaryOut(r.before_summary),
          afterSummary: summaryOut(r.after_summary),
          correlationId: r.correlation_id,
        })),
        nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.seq) : null,
      };
    },
  );
}
