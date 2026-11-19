import type { SqliteDatabase } from "@gtm/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { HttpError, parseOrThrow } from "../../http/errors.js";
import { readIdempotencyKey, runIdempotentAsync } from "../../http/idempotency.js";
import { recordAudit } from "../audit/index.js";
import type { HypothesisActor } from "./refusal.js";
import type { HypothesisReview } from "./review.js";
import type { HypothesisService } from "./service.js";

// Hypothesis routes (task T055; contract hypotheses.openapi.yaml). Editing needs hypotheses.edit; a status
// change or flag acknowledgement additionally needs hypotheses.review and a note.

export interface HypothesisRouteDeps {
  db: SqliteDatabase;
  service: HypothesisService;
  review: HypothesisReview;
  authz: Authz;
  now?: () => Date;
}

const Id = z.object({ id: z.string().min(1).max(64) });
const Status = z.enum(["untested", "strengthening", "weakening", "validated", "rejected", "stale"]);
const Relevance = z
  .object({
    icp: z
      .array(z.enum(["icp1", "icp2"]))
      .max(2)
      .optional(),
    capability: z.array(z.string().max(60)).max(20).optional(),
    offer: z.array(z.string().max(60)).max(20).optional(),
  })
  .strict();
const Confidence = z
  .object({ band: z.enum(["low", "medium", "high"]), explanation: z.string().min(3).max(500) })
  .strict();
const Create = z
  .object({
    statement: z.string().min(10).max(500),
    category: z.string().min(1).max(60),
    relevance: Relevance.optional(),
    supportingSignalIds: z.array(z.string().max(64)).min(1).max(50),
    contradictorySignalIds: z.array(z.string().max(64)).max(50).optional(),
    assumptions: z.array(z.string().min(3).max(300)).max(20).optional(),
    confidence: Confidence,
  })
  .strict();
const Patch = z
  .object({
    statement: z.string().min(10).max(500).optional(),
    category: z.string().max(60).optional(),
    relevance: Relevance.optional(),
    confidence: Confidence.optional(),
    status: Status.optional(),
    note: z.string().min(3).max(500).optional(),
    acknowledgeFlag: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field" });

export function registerHypothesisRoutes(app: FastifyInstance, deps: HypothesisRouteDeps): void {
  const { db, service, review, authz } = deps;
  const clock = deps.now ?? (() => new Date());
  const read = [authz.authenticate, authz.requirePermission("hypotheses.read")];
  const edit = [authz.authenticate, authz.requirePermission("hypotheses.edit")];
  const either = [
    authz.authenticate,
    authz.requireAnyPermission("hypotheses.edit", "hypotheses.review"),
  ];
  const actorOf = (request: {
    principal?: { userId: string } | undefined;
    correlationId: string;
  }): HypothesisActor => ({
    userId: request.principal!.userId,
    actorType: "human",
    correlationId: request.correlationId || null,
    now: clock,
  });

  app.post("/api/v1/accounts/:id/hypotheses", { preHandler: edit }, async (request, reply) => {
    const { id } = parseOrThrow(Id, request.params);
    const body = parseOrThrow(Create, request.body);
    const key = readIdempotencyKey(request);
    const actor = actorOf(request);
    const result = await runIdempotentAsync(db, {
      actorId: actor.userId!,
      route: `POST /accounts/${id}/hypotheses`,
      key,
      body,
      successStatus: 201,
      now: clock,
      handler: () => service.create(actor, id, body),
    });
    return reply.status(result.status).send(result.body);
  });
  app.get("/api/v1/accounts/:id/hypotheses", { preHandler: read }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const q = parseOrThrow(
      z.object({
        acceptance: z.enum(["accepted", "proposed", "dismissed"]).optional(),
        status: Status.optional(),
        cursor: z.string().max(64).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
      request.query,
    );
    return service.list(id, q);
  });
  app.get("/api/v1/hypotheses/:id", { preHandler: read }, async (request) =>
    service.get(parseOrThrow(Id, request.params).id),
  );

  app.patch("/api/v1/hypotheses/:id", { preHandler: either }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const body = parseOrThrow(Patch, request.body);
    readIdempotencyKey(request);
    const actor = actorOf(request);
    const perms = (request.principal?.permissions ?? []) as readonly string[];
    const wantsReview = body.status !== undefined || body.acknowledgeFlag === true;
    const wantsEdit =
      body.statement !== undefined ||
      body.category !== undefined ||
      body.relevance !== undefined ||
      body.confidence !== undefined;
    const deny = (permission: string): never => {
      db.transaction((tx) =>
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: "human",
            action: `${permission}.denied`,
            entityType: "route",
            entityId: "/hypotheses/:id",
            outcome: "denied",
            after: { method: "PATCH" },
            correlationId: actor.correlationId,
          },
          clock,
        ),
      );
      throw new HttpError(403, "Forbidden");
    };
    if (wantsReview && !perms.includes("hypotheses.review")) deny("hypotheses.review");
    if (wantsEdit && !perms.includes("hypotheses.edit")) deny("hypotheses.edit");
    if (body.status !== undefined) review.changeStatus(actor, id, body.status, body.note ?? "");
    else if (body.acknowledgeFlag) review.acknowledgeFlag(actor, id, body.note ?? "");
    if (wantsEdit)
      service.edit(actor, id, {
        statement: body.statement,
        category: body.category,
        relevance: body.relevance,
        confidence: body.confidence,
      });
    return service.get(id);
  });

  app.post("/api/v1/hypotheses/:id/accept", { preHandler: edit }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    readIdempotencyKey(request);
    return service.accept(actorOf(request), id);
  });
  app.post("/api/v1/hypotheses/:id/dismiss", { preHandler: edit }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    readIdempotencyKey(request);
    return service.dismiss(actorOf(request), id);
  });
  app.post("/api/v1/hypotheses/:id/evidence", { preHandler: edit }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const body = parseOrThrow(
      z
        .object({
          signalId: z.string().min(1).max(64),
          role: z.enum(["supporting", "contradictory"]),
        })
        .strict(),
      request.body,
    );
    readIdempotencyKey(request);
    return service.link(actorOf(request), id, body.signalId, body.role);
  });
  app.post("/api/v1/hypotheses/:id/assumptions", { preHandler: edit }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const body = parseOrThrow(
      z
        .object({
          text: z.string().min(3).max(300),
          interpretationId: z.string().max(64).optional(),
        })
        .strict(),
      request.body,
    );
    readIdempotencyKey(request);
    return service.addAssumption(actorOf(request), id, body.text, body.interpretationId);
  });
  app.get("/api/v1/hypothesis-categories", { preHandler: read }, async () => ({
    items: (
      db.raw
        .prepare(
          "SELECT key, label, status_label FROM hypothesis_category WHERE active = 1 ORDER BY key",
        )
        .all() as { key: string; label: string; status_label: string }[]
    ).map((c) => ({ key: c.key, label: c.label, statusLabel: c.status_label })),
  }));
}
