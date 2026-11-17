import { ROLE_KEYS } from "@gtm/domain";
import type { SqliteDatabase } from "@gtm/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";
import { readIdempotencyKey, runIdempotent } from "../../http/idempotency.js";
import type { IdentityService } from "./service.js";

// Routes per contracts/users.openapi.yaml and auth.openapi.yaml, mounted under /api/v1.

const RoleKeySchema = z.enum(ROLE_KEYS);
const InviteSchema = z
  .object({
    email: z.string().max(254).pipe(z.email()),
    displayName: z.string().max(200).optional(),
    roles: z.array(RoleKeySchema).max(ROLE_KEYS.length).default([]),
  })
  .strict();
const RolesSchema = z.object({ roles: z.array(RoleKeySchema).max(ROLE_KEYS.length) }).strict();
const UserIdSchema = z.object({ userId: z.uuid() });
const ListQuerySchema = z.object({
  status: z.enum(["invited", "active", "deactivated"]).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export interface IdentityRouteDeps {
  db: SqliteDatabase;
  service: IdentityService;
  authz: Authz;
}

export function registerIdentityRoutes(app: FastifyInstance, deps: IdentityRouteDeps): void {
  const { db, service, authz } = deps;
  const manage = [authz.authenticate, authz.requirePermission("users.manage")];

  app.get("/api/v1/auth/me", { preHandler: authz.authenticate }, async (request) => {
    const p = request.principal!;
    const user = service.getUser(p.userId);
    return {
      id: user.id,
      email: user.email,
      ...(user.displayName ? { displayName: user.displayName } : {}),
      status: user.status,
      roles: user.roles,
      permissions: p.permissions,
    };
  });

  app.get("/api/v1/auth/session/check", { preHandler: authz.authenticate }, async () => ({
    status: "ok",
  }));

  app.get("/api/v1/roles", { preHandler: manage }, async () => service.listRoles());

  app.get("/api/v1/users", { preHandler: manage }, async (request) => {
    const query = parseOrThrow(ListQuerySchema, request.query);
    return service.listUsers({
      ...(query.status ? { status: query.status } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    });
  });

  app.get("/api/v1/users/:userId", { preHandler: manage }, async (request) =>
    service.getUser(parseOrThrow(UserIdSchema, request.params).userId),
  );

  app.post("/api/v1/users", { preHandler: manage }, async (request, reply) => {
    const body = parseOrThrow(InviteSchema, request.body);
    const key = readIdempotencyKey(request);
    const actor = actorOf(request);
    const result = runIdempotent(db, {
      actorId: actor.userId,
      route: "POST /users",
      key,
      body,
      successStatus: 201,
      handler: (tx) => service.invite(actor, body, tx),
    });
    return reply.status(result.status).send(result.body);
  });

  app.put("/api/v1/users/:userId/roles", { preHandler: manage }, async (request, reply) => {
    const { userId } = parseOrThrow(UserIdSchema, request.params);
    const body = parseOrThrow(RolesSchema, request.body);
    const key = readIdempotencyKey(request);
    const actor = actorOf(request);
    const result = runIdempotent(db, {
      actorId: actor.userId,
      route: `PUT /users/${userId}/roles`,
      key,
      body,
      successStatus: 200,
      handler: (tx) => service.setRoles(actor, userId, body.roles, tx),
    });
    return reply.status(result.status).send(result.body);
  });

  for (const action of ["deactivate", "reactivate"] as const) {
    app.post(`/api/v1/users/:userId/${action}`, { preHandler: manage }, async (request, reply) => {
      const { userId } = parseOrThrow(UserIdSchema, request.params);
      const key = readIdempotencyKey(request);
      const actor = actorOf(request);
      const result = runIdempotent(db, {
        actorId: actor.userId,
        route: `POST /users/${userId}/${action}`,
        key,
        body: {},
        successStatus: 200,
        handler: (tx) =>
          action === "deactivate"
            ? service.deactivate(actor, userId, tx)
            : service.reactivate(actor, userId, tx),
      });
      return reply.status(result.status).send(result.body);
    });
  }
}

function actorOf(request: { principal?: { userId: string } | undefined; correlationId: string }) {
  return { userId: request.principal!.userId, correlationId: request.correlationId || null };
}
