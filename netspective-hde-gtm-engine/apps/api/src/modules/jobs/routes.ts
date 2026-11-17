import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";
import type { JobService } from "./service.js";

// Read-only jobs view (task T081, contracts/jobs.openapi.yaml). Requires jobs.read. Payloads are never
// returned, and error details are the redacted ones stored by the job service.

const ListQuery = z.object({
  state: z.enum(["queued", "running", "succeeded", "failed"]).optional(),
  queue: z.string().max(100).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function registerJobRoutes(
  app: FastifyInstance,
  deps: { service: JobService; authz: Authz },
): void {
  const read = [deps.authz.authenticate, deps.authz.requirePermission("jobs.read")];

  app.get("/api/v1/jobs", { preHandler: read }, async (request) => {
    const q = parseOrThrow(ListQuery, request.query);
    return deps.service.list({
      ...(q.state ? { state: q.state } : {}),
      ...(q.queue ? { queue: q.queue } : {}),
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
  });

  // Registered before /jobs/:id so "queues" is not read as an id.
  app.get("/api/v1/jobs/queues", { preHandler: read }, async () => ({
    items: deps.service.stats(),
  }));

  app.get("/api/v1/jobs/:id", { preHandler: read }, async (request) =>
    deps.service.get(parseOrThrow(z.object({ id: z.string().max(64) }), request.params).id),
  );
}
