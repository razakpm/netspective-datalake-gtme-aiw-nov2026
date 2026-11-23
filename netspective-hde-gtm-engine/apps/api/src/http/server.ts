import Fastify, { type FastifyInstance } from "fastify";
import type { GuardPolicyConfig } from "@gtm/domain";
import type { Logger } from "pino";
import type { AppConfig } from "../config/index.js";
import { registerCorrelation } from "./correlation.js";
import { registerErrorHandling } from "./errors.js";
import { registerPhiGuard, type PhiGuardSink, type QuarantineHolder } from "./phi-guard.js";

export interface ServerOptions {
  config: AppConfig;
  logger: Logger;
  phiGuardSink?: PhiGuardSink;
  quarantine?: QuarantineHolder;
  guardPolicy?: GuardPolicyConfig;
  /** Feature modules register their routes here. Routes are added after the global hooks. */
  routes?: (app: FastifyInstance) => void | Promise<void>;
}

/**
 * Build the HTTP server: correlation ID, problem+json errors, body-size limit and the PHI guard are
 * installed before any route, so every route is covered (spec FR-017, FR-033, FR-049).
 */
export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const { config, logger } = options;

  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: config.limits.apiBodyBytes,
    // A signed download link (feature 006) is longer than the default 100 characters of a path parameter.
    maxParamLength: 400,
    // The built-in request log prints the raw URL, and a query string can hold PHI. We log the route
    // pattern ourselves below.
    disableRequestLogging: true,
    requestIdHeader: false,
    // pino's Logger lacks FastifyBaseLogger's exact generics; the runtime shape is compatible.
  }) as unknown as FastifyInstance;

  registerCorrelation(app);
  registerErrorHandling(app);
  registerPhiGuard(app, {
    maxBytes: config.limits.apiBodyBytes,
    ...(options.phiGuardSink ? { sink: options.phiGuardSink } : {}),
    ...(options.quarantine ? { quarantine: options.quarantine } : {}),
    ...(options.guardPolicy ? { policy: options.guardPolicy } : {}),
  });

  app.addHook("onResponse", (request, reply, done) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "request completed",
    );
    done();
  });

  await options.routes?.(app);
  return app;
}
