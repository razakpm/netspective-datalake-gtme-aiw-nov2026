import type { FastifyInstance } from "fastify";
import { resolveCorrelationId } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { runWithContext } from "../context.js";

declare module "fastify" {
  interface FastifyRequest {
    correlationId: string;
  }
}

export const CORRELATION_HEADER = "x-correlation-id";

/**
 * Give every request one correlation ID (spec FR-033). A well-formed inbound ID is kept; anything
 * else is replaced by a new UUIDv7. The ID is returned in the response, stored on the request and
 * placed in the async context so logs, audit events and jobs can read it.
 *
 * Registered directly on the root instance (not as an encapsulated plugin) so it covers every route.
 */
export function registerCorrelation(app: FastifyInstance): void {
  app.decorateRequest("correlationId", "");
  app.addHook("onRequest", (request, reply, done) => {
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_HEADER], uuidv7);
    request.correlationId = correlationId;
    void reply.header(CORRELATION_HEADER, correlationId);
    runWithContext({ correlationId }, done);
  });
}
