import type { SqliteDatabase } from "@gtm/db";
import { ORG_TYPES } from "@gtm/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { HttpError, parseOrThrow } from "../../http/errors.js";
import { readIdempotencyKey, runIdempotent } from "../../http/idempotency.js";
import {
  applyImportInTx,
  dryRunImport,
  getImportRun,
  parseOrReject,
  sha256,
  type ImportLimits,
} from "../../platform/imports/service.js";
import { ACCOUNT_CSV, processAccountRow } from "./import.js";
import { decideMerge, getReviewItem, type FieldChoice } from "./merge.js";
import type { ReviewItemRow } from "./review.js";
import type { AccountService } from "./service.js";

// Accounts, review queue and import-run routes (tasks T031 to T033; contracts accounts and review).

export interface ConflictResolver {
  decide(
    itemId: string,
    input: { decision: "accept" | "reject"; reason: string },
    actor: { userId: string; correlationId: string | null },
  ): ReviewItemRow;
}

export interface AccountRouteDeps {
  db: SqliteDatabase;
  service: AccountService;
  authz: Authz;
  limits: ImportLimits;
  /** Handles contact_conflict items; provided by the contacts module. */
  conflicts?: ConflictResolver;
}

const OrgTypeSchema = z.enum(ORG_TYPES);
const ListQuery = z.object({
  orgType: OrgTypeSchema.optional(),
  fit: z.enum(["strong", "possible", "weak", "excluded", "unknown"]).optional(),
  eligible: z.enum(["true", "false"]).optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const IdParam = z.object({ id: z.string().min(1).max(64) });
const UpdateBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    geography: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
    orgType: OrgTypeSchema.optional(),
    staffedBedCount: z.number().int().min(0).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field" });
const ReviewListQuery = z.object({
  kind: z.enum(["merge_candidate", "contact_conflict"]).optional(),
  state: z.enum(["open", "merged", "rejected", "accepted"]).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const DecisionBody = z
  .object({
    decision: z.enum(["merge", "accept", "reject"]),
    reason: z.string().min(3).max(500),
    survivorId: z.string().max(64).optional(),
    fieldChoices: z.record(z.string(), z.enum(["a", "b"])).optional(),
  })
  .strict();

const actorOf = (request: {
  principal?: { userId: string } | undefined;
  correlationId: string;
}) => ({
  userId: request.principal!.userId,
  correlationId: request.correlationId || null,
});

function reviewView(item: ReviewItemRow) {
  return {
    id: item.id,
    kind: item.kind,
    state: item.state,
    reasonCodes: JSON.parse(item.reason_codes) as string[],
    score: item.score,
    subjectA: { id: item.subject_a },
    subjectB: item.subject_b ? { id: item.subject_b } : null,
    proposedValues: item.proposed_values ? (JSON.parse(item.proposed_values) as unknown) : null,
    proposedAt: item.proposed_at,
    decidedBy: item.decided_by,
    decidedAt: item.decided_at,
    decisionReason: item.decision_reason,
  };
}

export function registerAccountRoutes(app: FastifyInstance, deps: AccountRouteDeps): void {
  const { db, service, authz, limits } = deps;
  const read = [authz.authenticate, authz.requirePermission("accounts.read")];
  const edit = [authz.authenticate, authz.requirePermission("accounts.edit")];
  const importer = [authz.authenticate, authz.requirePermission("accounts.import")];
  const decide = [authz.authenticate, authz.requirePermission("review.decide")];

  // CSV bodies arrive as text. The import inspects each row with the PHI guard itself, because a
  // PHI-like row must be rejected on its own while the rest of the file is processed (FR-018).
  app.addContentTypeParser(
    "text/csv",
    { parseAs: "string", bodyLimit: limits.maxBytes + 1024 },
    (_req, body, done) => done(null, body),
  );

  app.post(
    "/api/v1/accounts/import",
    { preHandler: importer, bodyLimit: limits.maxBytes + 1024, config: { skipPhiGuard: true } },
    async (request, reply) => {
      const query = parseOrThrow(
        z.object({ dry_run: z.enum(["true", "false"]).optional() }),
        request.query,
      );
      if (typeof request.body !== "string") {
        throw new HttpError(415, "Unsupported media type", "Send the file as text/csv");
      }
      const text = request.body;
      const rows = parseOrReject(text, ACCOUNT_CSV, limits);
      const actor = actorOf(request);
      const input = {
        kind: "accounts" as const,
        text,
        rows,
        process: processAccountRow,
        ctx: { actorId: actor.userId, correlationId: actor.correlationId, now: () => new Date() },
      };
      if (query.dry_run === "true") return reply.status(200).send(dryRunImport(db, input));
      const key = readIdempotencyKey(request);
      const result = runIdempotent(db, {
        actorId: actor.userId,
        route: "POST /accounts/import",
        key,
        body: { sha256: sha256(text) },
        successStatus: 201,
        handler: (tx) => applyImportInTx(tx, input),
      });
      return reply.status(result.status).send(result.body);
    },
  );

  app.get(
    "/api/v1/import-runs/:id",
    {
      preHandler: [
        authz.authenticate,
        authz.requireAnyPermission("accounts.read", "contacts.read"),
      ],
    },
    async (request) => getImportRun(db, parseOrThrow(IdParam, request.params).id),
  );

  app.get("/api/v1/accounts", { preHandler: read }, async (request) => {
    const q = parseOrThrow(ListQuery, request.query);
    return service.list({
      orgType: q.orgType,
      fit: q.fit,
      eligible: q.eligible === undefined ? undefined : q.eligible === "true",
      q: q.q,
      cursor: q.cursor,
      limit: q.limit,
    });
  });

  app.get("/api/v1/accounts/:id", { preHandler: read }, async (request) =>
    service.get(parseOrThrow(IdParam, request.params).id),
  );

  app.patch("/api/v1/accounts/:id", { preHandler: edit }, async (request) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const body = parseOrThrow(UpdateBody, request.body);
    readIdempotencyKey(request);
    return service.update(id, body, actorOf(request));
  });

  app.put(
    "/api/v1/accounts/:id/domains/:domain/shared",
    { preHandler: edit },
    async (request, reply) => {
      const params = parseOrThrow(
        z.object({ id: z.string().max(64), domain: z.string().max(253) }),
        request.params,
      );
      const body = parseOrThrow(z.object({ shared: z.boolean() }).strict(), request.body);
      service.setDomainShared(params.id, params.domain, body.shared, actorOf(request));
      return reply.status(204).send();
    },
  );

  app.get("/api/v1/review-items", { preHandler: read }, async (request) => {
    const q = parseOrThrow(ReviewListQuery, request.query);
    const limit = q.limit ?? 50;
    const rows = db.raw
      .prepare(
        `SELECT * FROM review_item WHERE state = ? AND (? IS NULL OR kind = ?) AND id > ? ORDER BY proposed_at, id LIMIT ?`,
      )
      .all(
        q.state ?? "open",
        q.kind ?? null,
        q.kind ?? null,
        q.cursor ?? "",
        limit + 1,
      ) as unknown as ReviewItemRow[];
    const page = rows.slice(0, limit);
    return {
      items: page.map(reviewView),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  });

  app.get("/api/v1/review-items/:id", { preHandler: read }, async (request) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const item = getReviewItem(db.raw, id);
    const view = reviewView(item);
    const detail = (accountId: string) => {
      try {
        return service.get(accountId);
      } catch {
        return { id: accountId };
      }
    };
    return {
      ...view,
      ...(item.kind === "merge_candidate"
        ? {
            subjectA: detail(item.subject_a),
            subjectB: item.subject_b ? detail(item.subject_b) : null,
          }
        : {}),
    };
  });

  app.post("/api/v1/review-items/:id/decision", { preHandler: decide }, async (request) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const body = parseOrThrow(DecisionBody, request.body);
    readIdempotencyKey(request);
    const item = getReviewItem(db.raw, id);
    const actor = actorOf(request);
    if (item.kind === "merge_candidate") {
      if (body.decision === "accept")
        throw new HttpError(400, "Invalid decision", "Use merge or reject");
      return reviewView(
        decideMerge(
          db,
          id,
          {
            decision: body.decision,
            reason: body.reason,
            survivorId: body.survivorId,
            fieldChoices: body.fieldChoices as Record<string, FieldChoice> | undefined,
          },
          actor,
        ),
      );
    }
    if (!deps.conflicts)
      throw new HttpError(409, "Not available", "Contact conflicts are not enabled");
    if (body.decision === "merge")
      throw new HttpError(400, "Invalid decision", "Use accept or reject");
    return reviewView(
      deps.conflicts.decide(id, { decision: body.decision, reason: body.reason }, actor),
    );
  });
}
