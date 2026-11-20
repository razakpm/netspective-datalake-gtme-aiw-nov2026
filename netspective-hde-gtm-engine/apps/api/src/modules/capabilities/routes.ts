import type { SqliteDatabase } from "@gtm/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";
import { catalogueActor, IdParam, mutate } from "../../platform/catalogue-routes.js";
import type { CapabilityService } from "./service.js";

// Capability routes (feature 005; contract capabilities.openapi.yaml). Permissions are checked, and
// refusals audited, in the service.

export interface CapabilityRouteDeps {
  db: SqliteDatabase;
  capabilities: CapabilityService;
  authz: Authz;
  now?: () => Date;
}

export function registerCapabilityRoutes(app: FastifyInstance, deps: CapabilityRouteDeps): void {
  const { db, capabilities, authz } = deps;
  const auth = { preHandler: [authz.authenticate] };
  const actor = (r: Parameters<typeof catalogueActor>[0]) => catalogueActor(r, deps.now);
  const OfferLink = IdParam.extend({ offerId: z.string().min(1).max(100) });

  app.get("/api/v1/service-capabilities", auth, async (request) => ({
    items: capabilities.list(actor(request)),
  }));
  app.get("/api/v1/service-capabilities/:id", auth, async (request) =>
    capabilities.get(actor(request), parseOrThrow(IdParam, request.params).id),
  );
  app.patch("/api/v1/service-capabilities/:id", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `PATCH /service-capabilities/${id}`,
      request.body,
      200,
      deps.now,
      () => capabilities.update(a, id, request.body),
    );
    return reply.status(200).send(result.body);
  });
  app.post("/api/v1/service-capabilities/:id/evidence", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /service-capabilities/${id}/evidence`,
      request.body,
      201,
      deps.now,
      () => capabilities.addEvidence(a, id, request.body),
    );
    return reply.status(result.status).send(result.body);
  });
  app.post("/api/v1/service-capabilities/:id/delivery-examples", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /service-capabilities/${id}/delivery-examples`,
      request.body,
      201,
      deps.now,
      () => capabilities.addExample(a, id, request.body),
    );
    return reply.status(result.status).send(result.body);
  });
  app.put("/api/v1/service-capabilities/:id/offers/:offerId", auth, async (request, reply) => {
    const { id, offerId } = parseOrThrow(OfferLink, request.params);
    capabilities.link(actor(request), id, offerId);
    return reply.status(204).send();
  });
  app.delete("/api/v1/service-capabilities/:id/offers/:offerId", auth, async (request, reply) => {
    const { id, offerId } = parseOrThrow(OfferLink, request.params);
    capabilities.unlink(actor(request), id, offerId);
    return reply.status(204).send();
  });
  app.put("/api/v1/service-capabilities/:id/public-claim-status", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `PUT /service-capabilities/${id}/public-claim-status`,
      request.body,
      200,
      deps.now,
      () => capabilities.setPublicClaimStatus(a, id, request.body),
    );
    return reply.status(200).send(result.body);
  });
}
