import type { SqliteDatabase } from "@gtm/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";
import { readIdempotencyKey, runIdempotentAsync } from "../../http/idempotency.js";
import type { ProblemInterpreter } from "./interpret.js";
import type { ResearchSchedules } from "./schedule.js";
import type { ResearchService } from "./service.js";
import type { ResearchActor } from "./settings.js";
import { RULE_KINDS, type ResearchSourceRules } from "./sources.js";

// Research, interpretation and source-list routes (tasks T054 and T071; contract research.openapi.yaml).

export interface ResearchRouteDeps {
  db: SqliteDatabase;
  service: ResearchService;
  schedules: ResearchSchedules;
  interpreter: ProblemInterpreter;
  rules: ResearchSourceRules;
  authz: Authz;
  now?: () => Date;
}

const Id = z.object({ id: z.string().min(1).max(64) });
const Page = {
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
};
const StartBody = z
  .object({
    maxSources: z.number().int().min(1).max(25).optional(),
    maxCost: z
      .string()
      .regex(/^[0-9]{1,4}(\.[0-9]{1,6})?$/)
      .optional(),
    sources: z
      .array(
        z
          .object({
            address: z.string().min(1).max(2000),
            capturedText: z.string().max(200000).optional(),
          })
          .strict(),
      )
      .max(25)
      .optional(),
  })
  .strict();
const RunStates = z.enum([
  "queued",
  "running",
  "completed",
  "budget_reached",
  "needs_attention",
  "failed",
  "cancelled",
]);

export function registerResearchRoutes(app: FastifyInstance, deps: ResearchRouteDeps): void {
  const { db, service, schedules, interpreter, rules, authz } = deps;
  const clock = deps.now ?? (() => new Date());
  const read = [authz.authenticate, authz.requirePermission("research.read")];
  const run = [authz.authenticate, authz.requirePermission("research.run")];
  const attention = [
    authz.authenticate,
    authz.requireAnyPermission("research.run", "hypotheses.review"),
  ];
  const manage = [authz.authenticate, authz.requirePermission("research.sources.manage")];
  const actorOf = (request: {
    principal?: { userId: string } | undefined;
    correlationId: string;
  }): ResearchActor => ({
    userId: request.principal!.userId,
    actorType: "human",
    correlationId: request.correlationId || null,
    now: clock,
  });

  app.post("/api/v1/accounts/:id/research", { preHandler: run }, async (request, reply) => {
    const { id } = parseOrThrow(Id, request.params);
    const body = parseOrThrow(StartBody, request.body);
    const key = readIdempotencyKey(request);
    const actor = actorOf(request);
    const result = await runIdempotentAsync(db, {
      actorId: actor.userId!,
      route: `POST /accounts/${id}/research`,
      key,
      body,
      successStatus: 202,
      now: clock,
      handler: () => service.startRun(actor, id, body),
    });
    return reply.status(result.status === 200 ? 202 : result.status).send(result.body);
  });

  app.get("/api/v1/accounts/:id/research", { preHandler: read }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const q = parseOrThrow(z.object(Page), request.query);
    return service.list({ accountId: id, ...q });
  });

  app.get("/api/v1/accounts/:id/research-summary", { preHandler: read }, async (request) =>
    service.accountSummary(parseOrThrow(Id, request.params).id),
  );

  app.put("/api/v1/accounts/:id/research/schedule", { preHandler: run }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const body = parseOrThrow(
      z
        .object({ enabled: z.boolean(), cadence: z.enum(["weekly", "monthly"]).optional() })
        .strict(),
      request.body,
    );
    return schedules.set(actorOf(request), id, body);
  });

  app.get("/api/v1/research-runs", { preHandler: read }, async (request) => {
    const q = parseOrThrow(z.object({ state: RunStates.optional(), ...Page }), request.query);
    return service.list(q);
  });
  app.get("/api/v1/research-runs/:id", { preHandler: read }, async (request) =>
    service.detail(parseOrThrow(Id, request.params).id),
  );

  app.post("/api/v1/research-runs/:id/cancel", { preHandler: run }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    readIdempotencyKey(request);
    return service.cancel(actorOf(request), id);
  });
  app.post("/api/v1/research-runs/:id/acknowledge", { preHandler: attention }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const body = parseOrThrow(
      z.object({ note: z.string().min(3).max(500) }).strict(),
      request.body,
    );
    readIdempotencyKey(request);
    return service.acknowledge(actorOf(request), id, body.note);
  });

  app.post(
    "/api/v1/accounts/:id/problem-interpretations",
    { preHandler: run },
    async (request, reply) => {
      const { id } = parseOrThrow(Id, request.params);
      const body = parseOrThrow(
        z
          .object({
            statement: z.string().min(10).max(2000),
            sourceSignalId: z.string().max(64).optional(),
          })
          .strict(),
        request.body,
      );
      const key = readIdempotencyKey(request);
      const actor = actorOf(request);
      const result = await runIdempotentAsync(db, {
        actorId: actor.userId!,
        route: `POST /accounts/${id}/problem-interpretations`,
        key,
        body,
        successStatus: 201,
        now: clock,
        handler: () => interpreter.interpret(actor, id, body),
      });
      return reply.status(result.status).send(result.body);
    },
  );

  app.get("/api/v1/research-sources", { preHandler: read }, async () => rules.list());
  app.post("/api/v1/research-sources", { preHandler: manage }, async (request, reply) => {
    const body = parseOrThrow(
      z
        .object({
          kind: z.enum(RULE_KINDS),
          matchType: z.enum(["host", "host_suffix"]),
          pattern: z.string().min(3).max(253),
        })
        .strict(),
      request.body,
    );
    readIdempotencyKey(request);
    return reply.status(201).send(rules.create(actorOf(request), body));
  });
  app.patch("/api/v1/research-sources/:id", { preHandler: manage }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const body = parseOrThrow(
      z.object({ status: z.enum(["enabled", "disabled"]) }).strict(),
      request.body,
    );
    return rules.setStatus(actorOf(request), id, body.status);
  });
}
