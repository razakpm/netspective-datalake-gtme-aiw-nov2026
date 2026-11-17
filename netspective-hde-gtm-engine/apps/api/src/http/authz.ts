import type { AuditEventInput, Permission } from "@gtm/domain";
import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import {
  KeysUnavailableError,
  TokenInvalidError,
  type VerifiedIdentity,
} from "../modules/identity/index.js";
import { HttpError } from "./errors.js";

// Authentication and authorisation (task T043). Deny by default: a route is reachable only after
// `authenticate` succeeds, and `requirePermission` checks the permissions loaded from the database
// for THIS request. Roles are never read from token claims (spec FR-006, research R-05).

export interface AuthPrincipal {
  userId: string;
  email: string;
  permissions: readonly Permission[];
}

export type AuthResolveResult =
  { kind: "ok"; principal: AuthPrincipal } | { kind: "denied"; reason: string };

export interface AuthzDeps {
  verifier: { verify(token: string): Promise<VerifiedIdentity> };
  resolve(identity: VerifiedIdentity, correlationId: string | null): AuthResolveResult;
  /** Persist a refused attempt (own transaction, survives rollback of the request). */
  auditDenied(event: AuditEventInput): void;
}

declare module "fastify" {
  interface FastifyRequest {
    principal: AuthPrincipal | undefined;
  }
}

export function createAuthz(deps: AuthzDeps) {
  const authenticate: preHandlerAsyncHookHandler = async (request) => {
    const header = request.headers.authorization;
    const match = typeof header === "string" ? /^Bearer (\S+)$/.exec(header) : null;
    if (!match?.[1]) throw unauthenticated();

    let identity: VerifiedIdentity;
    try {
      identity = await deps.verifier.verify(match[1]);
    } catch (error) {
      if (error instanceof KeysUnavailableError) {
        throw new HttpError(503, "Service unavailable", "Sign-in cannot be validated right now");
      }
      if (error instanceof TokenInvalidError) throw unauthenticated();
      throw error;
    }

    const result = deps.resolve(identity, request.correlationId || null);
    if (result.kind === "denied") {
      deps.auditDenied({
        actorId: null,
        actorType: "human",
        action: "auth.denied",
        entityType: "user",
        outcome: "denied",
        after: { reason: result.reason },
        correlationId: request.correlationId || null,
      });
      throw new HttpError(403, "Forbidden");
    }
    request.principal = result.principal;
  };

  function requirePermission(permission: Permission): preHandlerAsyncHookHandler {
    return async (request: FastifyRequest) => {
      const principal = request.principal;
      if (!principal) throw unauthenticated(); // deny by default
      if (!principal.permissions.includes(permission)) {
        deps.auditDenied({
          actorId: principal.userId,
          actorType: "human",
          action: `${permission}.denied`,
          entityType: "route",
          entityId: request.routeOptions.url ?? null,
          outcome: "denied",
          after: { method: request.method },
          correlationId: request.correlationId || null,
        });
        throw new HttpError(403, "Forbidden");
      }
    };
  }

  /** Allow when the principal holds at least one of the permissions; a refusal is audited like any other. */
  function requireAnyPermission(...permissions: Permission[]): preHandlerAsyncHookHandler {
    return async (request: FastifyRequest) => {
      const principal = request.principal;
      if (!principal) throw unauthenticated();
      if (!permissions.some((p) => principal.permissions.includes(p))) {
        deps.auditDenied({
          actorId: principal.userId,
          actorType: "human",
          action: `${permissions[0]}.denied`,
          entityType: "route",
          entityId: request.routeOptions.url ?? null,
          outcome: "denied",
          after: { method: request.method },
          correlationId: request.correlationId || null,
        });
        throw new HttpError(403, "Forbidden");
      }
    };
  }

  return { authenticate, requirePermission, requireAnyPermission };
}

export type Authz = ReturnType<typeof createAuthz>;

function unauthenticated(): HttpError {
  return new HttpError(401, "Unauthenticated");
}
