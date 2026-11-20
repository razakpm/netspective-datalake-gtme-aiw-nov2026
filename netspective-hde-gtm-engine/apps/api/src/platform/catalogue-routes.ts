import type { SqliteDatabase } from "@gtm/db";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { readIdempotencyKey, runIdempotentAsync } from "../http/idempotency.js";
import type { CatalogueActor } from "./catalogue.js";

// Helpers shared by the claims, offers and capabilities routes (feature 005). Permissions are checked in the
// services, which audit every refusal, so a route only needs the caller to be signed in.

type Req = Pick<FastifyRequest, "principal" | "correlationId" | "headers">;

export function catalogueActor(request: Req, now?: () => Date): CatalogueActor {
  return {
    userId: request.principal!.userId,
    actorType: "human",
    correlationId: request.correlationId || null,
    permissions: request.principal!.permissions,
    now,
  };
}

/** Run a change once per (actor, route, Idempotency-Key): a replay returns the stored result. */
export async function mutate<T>(
  db: SqliteDatabase,
  request: Req,
  route: string,
  body: unknown,
  successStatus: number,
  now: (() => Date) | undefined,
  handler: () => T,
) {
  return runIdempotentAsync(db, {
    actorId: request.principal!.userId,
    route,
    key: readIdempotencyKey(request as FastifyRequest),
    body,
    successStatus,
    ...(now ? { now } : {}),
    handler,
  });
}

export const IdParam = z.object({ id: z.string().min(1).max(100) });
