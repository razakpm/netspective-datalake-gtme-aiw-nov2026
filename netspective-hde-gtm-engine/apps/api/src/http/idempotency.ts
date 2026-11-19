import { createHash } from "node:crypto";
import type { SqliteDatabase, Tx } from "@gtm/db";
import { guardValue } from "@gtm/domain";
import type { FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { HttpError } from "./errors.js";

// API idempotency (task T044, spec FR-055). The same key and body returns the stored result with no
// second effect; the same key with a different body is a 422. Keys are scoped per actor and route.
// The record is written in the same transaction as the change it protects. Retention: 24 hours.

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotentResult<T> {
  status: number;
  body: T;
}

export function readIdempotencyKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8 || key.length > 128) {
    throw new HttpError(
      400,
      "Idempotency-Key required",
      "Send an Idempotency-Key header of 8 to 128 characters",
    );
  }
  return key;
}

/** Stable JSON: object keys sorted, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashRequest(body: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(body ?? null))
    .digest("hex");
}

export interface IdempotentCall<T> {
  actorId: string;
  /** Operation, for example "POST /users" or "PUT /users/:id/roles:<id>". */
  route: string;
  key: string;
  body: unknown;
  successStatus: number;
  handler: (tx: Tx) => T;
  now?: () => Date;
}

/** Run `handler` once per (actor, route, key). Replays return status 200 with the stored body. */
export function runIdempotent<T>(db: SqliteDatabase, call: IdempotentCall<T>): IdempotentResult<T> {
  const now = call.now ?? (() => new Date());
  const hash = hashRequest(call.body);
  return db.transaction((tx) => {
    const existing = tx
      .prepare(
        `SELECT request_hash, response_body, expires_at FROM idempotency_record
         WHERE actor_id = ? AND route = ? AND idempotency_key = ?`,
      )
      .get(call.actorId, call.route, call.key) as
      { request_hash: string; response_body: string; expires_at: string } | undefined;

    if (existing) {
      if (existing.expires_at > now().toISOString()) {
        if (existing.request_hash !== hash) {
          throw new HttpError(
            422,
            "Idempotency key reused",
            "This Idempotency-Key was already used with a different request",
          );
        }
        return { status: 200, body: JSON.parse(existing.response_body) as T };
      }
      tx.prepare(
        "DELETE FROM idempotency_record WHERE actor_id = ? AND route = ? AND idempotency_key = ?",
      ).run(call.actorId, call.route, call.key);
    }

    const body = call.handler(tx);
    const decision = guardValue(body);
    if (decision.decision !== "allow") {
      // Never store a response the PHI guard rejects; the change itself rolls back with it.
      throw new HttpError(422, "Response blocked", "The result cannot be stored", {
        type: "urn:gtm:problem:phi-blocked",
        ruleIds: decision.rule_ids,
      });
    }
    tx.prepare(
      `INSERT INTO idempotency_record (id, actor_id, route, idempotency_key, request_hash,
         response_status, response_body, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      uuidv7(),
      call.actorId,
      call.route,
      call.key,
      hash,
      call.successStatus,
      JSON.stringify(body),
      now().toISOString(),
      new Date(now().getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
    );
    return { status: call.successStatus, body };
  });
}

/**
 * Idempotency for a call whose work runs in its own transactions (for example a service that enqueues a
 * job). The stored result is checked first, the work runs once, and the result is stored afterwards. A
 * crash between the work and the record can repeat the call once the record expires; such calls are
 * additionally protected by their own constraints (for example one active research run per account).
 */
export async function runIdempotentAsync<T>(
  db: SqliteDatabase,
  call: Omit<IdempotentCall<T>, "handler"> & { handler: () => Promise<T> | T },
): Promise<IdempotentResult<T>> {
  const now = call.now ?? (() => new Date());
  const hash = hashRequest(call.body);
  const existing = db.raw
    .prepare(
      `SELECT request_hash, response_body, expires_at FROM idempotency_record
       WHERE actor_id = ? AND route = ? AND idempotency_key = ?`,
    )
    .get(call.actorId, call.route, call.key) as
    { request_hash: string; response_body: string; expires_at: string } | undefined;
  if (existing && existing.expires_at > now().toISOString()) {
    if (existing.request_hash !== hash) {
      throw new HttpError(
        422,
        "Idempotency key reused",
        "This Idempotency-Key was already used with a different request",
      );
    }
    return { status: 200, body: JSON.parse(existing.response_body) as T };
  }
  const body = await call.handler();
  const decision = guardValue(body);
  if (decision.decision !== "allow") {
    throw new HttpError(422, "Response blocked", "The result cannot be stored", {
      type: "urn:gtm:problem:phi-blocked",
      ruleIds: decision.rule_ids,
    });
  }
  db.transaction((tx) => {
    tx.prepare(
      "DELETE FROM idempotency_record WHERE actor_id = ? AND route = ? AND idempotency_key = ?",
    ).run(call.actorId, call.route, call.key);
    tx.prepare(
      `INSERT INTO idempotency_record (id, actor_id, route, idempotency_key, request_hash,
         response_status, response_body, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      uuidv7(),
      call.actorId,
      call.route,
      call.key,
      hash,
      call.successStatus,
      JSON.stringify(body),
      now().toISOString(),
      new Date(now().getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
    );
  });
  return { status: call.successStatus, body };
}
