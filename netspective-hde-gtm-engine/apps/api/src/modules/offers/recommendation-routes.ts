import type { SqliteDatabase } from "@gtm/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";
import { catalogueActor, IdParam, mutate } from "../../platform/catalogue-routes.js";
import type { RecommendationService } from "./recommendations.js";
import type { RuleSetService, RuleSetView } from "./rule-sets.js";
import type { WaitlistService } from "./waitlist.js";

// Recommendation and routing rule set routes (feature 006; contract routing.openapi.yaml). Permissions are
// checked, and refusals audited, in the services.

export interface RecommendationRouteDeps {
  db: SqliteDatabase;
  recommendations: RecommendationService;
  ruleSets: RuleSetService;
  waitlist: WaitlistService;
  authz: Authz;
  now?: () => Date;
}

const ReviewBody = z
  .object({
    decision: z.enum(["accept", "dismiss"]),
    reason: z.string().max(500).optional(),
  })
  .strict();
const VersionParam = z.object({ version: z.coerce.number().int().min(1) });
const RuleSetBody = z.object({ rules: z.array(z.unknown()).min(1), reason: z.string() }).strict();
const ActivateBody = z.object({ reason: z.string() }).strict();
const ruleSetOut = (v: RuleSetView) => ({ ...v, rules: v.rules.rules });
const QueueQuery = z.object({ state: z.enum(["pending"]).optional() });

export function registerRecommendationRoutes(
  app: FastifyInstance,
  deps: RecommendationRouteDeps,
): void {
  const { db, recommendations, ruleSets, waitlist, authz } = deps;
  const auth = { preHandler: [authz.authenticate] };
  const actor = (r: Parameters<typeof catalogueActor>[0]) => catalogueActor(r, deps.now);

  app.get("/api/v1/accounts/:id/offer-recommendations", auth, async (request) => ({
    items: recommendations.listForAccount(actor(request), parseOrThrow(IdParam, request.params).id),
  }));
  app.post("/api/v1/accounts/:id/offer-recommendations", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const body = parseOrThrow(
      z.object({ contactId: z.string().min(1).optional() }).strict(),
      request.body ?? {},
    );
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /accounts/${id}/offer-recommendations`,
      body,
      201,
      deps.now,
      () =>
        recommendations.recommend(a, {
          accountId: id,
          ...(body.contactId ? { contactId: body.contactId } : {}),
        }),
    );
    return reply.status(result.status).send(result.body);
  });
  app.get("/api/v1/offer-recommendations", auth, async (request) => {
    parseOrThrow(QueueQuery, request.query);
    return { items: recommendations.pendingQueue(actor(request)) };
  });
  app.get("/api/v1/offer-recommendations/:id", auth, async (request) =>
    recommendations.get(actor(request), parseOrThrow(IdParam, request.params).id),
  );
  app.post("/api/v1/offer-recommendations/:id/review", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const body = parseOrThrow(ReviewBody, request.body);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /offer-recommendations/${id}/review`,
      body,
      200,
      deps.now,
      () =>
        body.decision === "accept"
          ? recommendations.accept(a, id)
          : recommendations.dismiss(a, id, { reason: body.reason }),
    );
    return reply.status(result.status).send(result.body);
  });

  const EntryParam = z.object({
    id: z.string().min(1).max(100),
    entryId: z.string().min(1).max(100),
  });
  app.get("/api/v1/offers/:id/waitlist", auth, async (request) => ({
    items: waitlist.list(actor(request), parseOrThrow(IdParam, request.params).id),
  }));
  app.post("/api/v1/offers/:id/waitlist", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /offers/${id}/waitlist`,
      request.body,
      201,
      deps.now,
      () => waitlist.add(a, id, request.body),
    );
    return reply.status(result.status).send(result.body);
  });
  app.post("/api/v1/offers/:id/waitlist/:entryId/close", auth, async (request, reply) => {
    const { id, entryId } = parseOrThrow(EntryParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /offers/${id}/waitlist/${entryId}/close`,
      request.body,
      200,
      deps.now,
      () => waitlist.close(a, id, entryId, request.body),
    );
    return reply.status(result.status).send(result.body);
  });

  app.get("/api/v1/routing-rule-sets", auth, async (request) => ({
    items: ruleSets.list(actor(request)).map(ruleSetOut),
  }));
  app.post("/api/v1/routing-rule-sets", auth, async (request, reply) => {
    const body = parseOrThrow(RuleSetBody, request.body);
    const a = actor(request);
    const result = await mutate(db, request, "POST /routing-rule-sets", body, 201, deps.now, () =>
      ruleSetOut(ruleSets.createDraft(a, { rules: { rules: body.rules }, reason: body.reason })),
    );
    return reply.status(result.status).send(result.body);
  });
  app.post("/api/v1/routing-rule-sets/:version/activate", auth, async (request, reply) => {
    const { version } = parseOrThrow(VersionParam, request.params);
    const body = parseOrThrow(ActivateBody, request.body);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /routing-rule-sets/${version}/activate`,
      body,
      200,
      deps.now,
      () => ruleSetOut(ruleSets.activate(a, version, body)),
    );
    return reply.status(result.status).send(result.body);
  });
}
