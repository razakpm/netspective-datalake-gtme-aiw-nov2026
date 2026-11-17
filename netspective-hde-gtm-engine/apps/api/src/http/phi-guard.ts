import type { FastifyInstance } from "fastify";
import {
  DEFAULT_GUARD_POLICY,
  guardValue,
  resolveGuardAction,
  type GuardAction,
  type GuardDecision,
  type GuardPolicyConfig,
} from "@gtm/domain";
import { sendProblem } from "./errors.js";

// PHI boundary guard middleware (constitution Principle IV; spec FR-017, FR-019, FR-021).
// It inspects the body, query string, path parameters and headers of every request before the route
// handler runs and before anything is stored or logged. A blocked request is answered with 422 and a
// content-free problem body. The raw URL is never logged because the query string may hold PHI.
//
// Default action is reject. At an entry point configured for review (and only when a quarantine holder is
// wired in) the content is held encrypted for a reviewer and the request answered with 202; without a
// holder a quarantine-configured entry point rejects.

declare module "fastify" {
  interface FastifyContextConfig {
    /** Explicit opt-out for routes that inspect their own raw input (for example webhook ingress). */
    skipPhiGuard?: boolean;
  }
}

export type GuardedPart = "body" | "query" | "params" | "headers";

export interface PhiBlockEvent {
  entryPoint: "api_body";
  action: GuardAction;
  decision: GuardDecision;
  parts: GuardedPart[];
  correlationId: string;
  method: string;
  /** The route pattern (for example /users/:id), never the raw URL. */
  route: string;
}

/** Receives block events. The database-backed sink (decision row, audit event, alert) arrives later. */
export interface PhiGuardSink {
  onBlocked(event: PhiBlockEvent): void | Promise<void>;
}

/** Holds suspected content for human review (quarantine-service.ts). Returns the item id. */
export interface QuarantineHolder {
  hold(input: {
    entryPoint: string;
    content: string;
    ruleIds: string[];
    guardVersion: string;
  }): string | Promise<string>;
}

export interface PhiGuardOptions {
  quarantine?: QuarantineHolder;
  sink?: PhiGuardSink;
  policy?: GuardPolicyConfig;
  maxBytes: number;
}

// Credentials are handled by authentication, not by the content guard.
const SKIPPED_HEADERS = new Set(["authorization", "cookie", "set-cookie"]);

function inspectableHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SKIPPED_HEADERS.has(name.toLowerCase())),
  );
}

export function registerPhiGuard(app: FastifyInstance, options: PhiGuardOptions): void {
  const policy = options.policy ?? DEFAULT_GUARD_POLICY;

  app.addHook("preValidation", async (request, reply) => {
    if (request.routeOptions.config.skipPhiGuard === true) return;

    const action = resolveGuardAction("api_body", policy);
    const parts: [GuardedPart, unknown][] = [
      ["body", request.body],
      ["query", request.query],
      ["params", request.params],
      ["headers", inspectableHeaders(request.headers)],
    ];

    const triggered: GuardedPart[] = [];
    const ruleIds = new Set<string>();
    let guardVersion = "";
    for (const [name, value] of parts) {
      if (value === undefined || value === null) continue;
      const decision = guardValue(value, { onMatch: action, maxBytes: options.maxBytes });
      guardVersion = decision.guard_version;
      if (decision.decision !== "allow") {
        triggered.push(name);
        for (const id of decision.rule_ids) ruleIds.add(id);
      }
    }
    if (triggered.length === 0) return;

    const sortedRules = [...ruleIds].sort();
    let quarantineId: string | undefined;
    if (action === "quarantine" && options.quarantine) {
      try {
        quarantineId = await options.quarantine.hold({
          entryPoint: "api_body",
          content: JSON.stringify(
            Object.fromEntries(parts.filter(([name]) => triggered.includes(name))),
          ),
          ruleIds: sortedRules,
          guardVersion,
        });
      } catch (error) {
        // If we cannot hold it safely, we reject: the content must not pass or be lost into a log.
        request.log.error({ err: error }, "quarantine hold failed");
      }
    }
    const route = request.routeOptions.url ?? "unmatched";
    try {
      await options.sink?.onBlocked({
        entryPoint: "api_body",
        action,
        decision: { decision: action, rule_ids: sortedRules, guard_version: guardVersion },
        parts: triggered,
        correlationId: request.correlationId,
        method: request.method,
        route,
      });
    } catch (error) {
      // A failing sink must never let the request through, and must not lose the block.
      request.log.error({ err: error }, "phi guard sink failed");
    }
    request.log.warn(
      { route, ruleIds: sortedRules, parts: triggered },
      "request blocked by PHI guard",
    );

    if (quarantineId !== undefined) {
      return reply
        .status(202)
        .send({ status: "quarantined", correlationId: request.correlationId });
    }

    return sendProblem(request, reply, {
      type: "urn:gtm:problem:phi-blocked",
      title: "Request blocked by the PHI boundary guard",
      status: 422,
      detail:
        "The request contains content that may be protected health information or a credential. Remove it and try again.",
      ruleIds: sortedRules,
    });
  });
}
