import type { SqliteDatabase } from "@gtm/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";
import type { QuarantineService } from "./quarantine-service.js";

// Quarantine review routes (task T068, contracts/quarantine.openapi.yaml). Every route needs
// `quarantine.review`. Content leaves only through the view endpoint, which is logged as an access.

const IdParams = z.object({ id: z.uuid() });
const PurposeBody = z.object({ purpose: z.string().trim().min(3).max(200) }).strict();
const DecisionBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const ListQuery = z.object({ status: z.enum(["held", "released", "discarded"]).optional() });

export function registerQuarantineRoutes(
  app: FastifyInstance,
  deps: { db: SqliteDatabase; service: QuarantineService; authz: Authz },
): void {
  const { db, service, authz } = deps;
  const review = [authz.authenticate, authz.requirePermission("quarantine.review")];
  const actorOf = (request: {
    principal?: { userId: string } | undefined;
    correlationId: string;
  }) => ({
    userId: request.principal!.userId,
    actorType: "human" as const,
    correlationId: request.correlationId || null,
  });

  app.get("/api/v1/quarantine-items", { preHandler: review }, async (request) => {
    const { status } = parseOrThrow(ListQuery, request.query);
    return { items: service.list(status) };
  });

  app.get("/api/v1/quarantine-items/:id", { preHandler: review }, async (request) =>
    service.getMeta(parseOrThrow(IdParams, request.params).id),
  );

  app.post("/api/v1/quarantine-items/:id/content", { preHandler: review }, async (request) => {
    const { id } = parseOrThrow(IdParams, request.params);
    const { purpose } = parseOrThrow(PurposeBody, request.body);
    const actor = actorOf(request);
    const content = db.transaction((tx) => service.view(tx, actor, id, purpose));
    return { id, content };
  });

  for (const action of ["release", "discard"] as const) {
    app.post(`/api/v1/quarantine-items/:id/${action}`, { preHandler: review }, async (request) => {
      const { id } = parseOrThrow(IdParams, request.params);
      const { reason } = parseOrThrow(DecisionBody, request.body);
      const actor = actorOf(request);
      return db.transaction((tx) =>
        action === "release"
          ? service.release(tx, actor, id, reason)
          : service.discard(tx, actor, id, reason),
      );
    });
  }

  app.get("/api/v1/phi-decisions", { preHandler: review }, async () => {
    const rows = db.raw
      .prepare("SELECT * FROM phi_guard_decision ORDER BY rowid DESC LIMIT 200")
      .all() as {
      id: string;
      occurred_at: string;
      entry_point: string;
      decision: string;
      rule_ids: string;
      guard_version: string;
      correlation_id: string | null;
      entity_ref: string | null;
    }[];
    return {
      items: rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        entryPoint: r.entry_point,
        decision: r.decision,
        ruleIds: JSON.parse(r.rule_ids) as string[],
        guardVersion: r.guard_version,
        correlationId: r.correlation_id,
        route: r.entity_ref,
      })),
    };
  });
}
