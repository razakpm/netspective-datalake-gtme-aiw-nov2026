import type { SqliteDatabase } from "@gtm/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";
import { catalogueActor, IdParam, mutate } from "../../platform/catalogue-routes.js";
import type { NoticeService } from "./notice.js";
import type { RequestService } from "./requests.js";

// Request inbox and notice version routes (feature 006; contract engagement.openapi.yaml). Permissions are
// checked, and refusals audited, in the services. Nothing here sends a message.

export interface EngagementRouteDeps {
  db: SqliteDatabase;
  requests: RequestService;
  notices: NoticeService;
  authz: Authz;
  now?: () => Date;
}

const ListQuery = z
  .object({
    state: z.enum(["received", "reviewed", "linked", "closed"]).optional(),
    kind: z.enum(["download", "working_session", "intake"]).optional(),
    flag: z.enum(["personal_email", "org_type_differs", "suppressed", "no_consent"]).optional(),
  })
  .strict();

export function registerEngagementRoutes(app: FastifyInstance, deps: EngagementRouteDeps): void {
  const { db, requests, notices, authz } = deps;
  const auth = { preHandler: [authz.authenticate] };
  const actor = (r: Parameters<typeof catalogueActor>[0]) => catalogueActor(r, deps.now);

  app.get("/api/v1/offer-requests", auth, async (request) => ({
    items: requests.list(actor(request), parseOrThrow(ListQuery, request.query)),
  }));
  app.get("/api/v1/offer-requests/:id", auth, async (request) =>
    requests.get(actor(request), parseOrThrow(IdParam, request.params).id),
  );
  app.post("/api/v1/offer-requests/:id/review", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /offer-requests/${id}/review`,
      request.body,
      200,
      deps.now,
      () => requests.review(a, id, request.body),
    );
    return reply.status(result.status).send(result.body);
  });

  app.get("/api/v1/notice-versions", auth, async (request) => ({
    items: notices.list(actor(request)),
  }));
  app.post("/api/v1/notice-versions", auth, async (request, reply) => {
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      "POST /notice-versions",
      request.body,
      201,
      deps.now,
      () => notices.create(a, request.body),
    );
    return reply.status(result.status).send(result.body);
  });
  app.post("/api/v1/notice-versions/:id/approve", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /notice-versions/${id}/approve`,
      {},
      200,
      deps.now,
      () => notices.approve(a, id),
    );
    return reply.status(result.status).send(result.body);
  });
}
