import { SOURCE_KINDS } from "@gtm/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";
import { readIdempotencyKey } from "../../http/idempotency.js";
import { toHttpError, SignalRefusal, type SignalActor } from "./actor.js";
import { getSignalDetail, listAccountSignals, listSignals } from "./queries.js";
import type { ReviewService } from "./review.js";
import type { SignalService } from "./service.js";
import type { SourceService } from "./sources.js";
import type { SqliteDatabase } from "@gtm/db";

// Signals, feed, review and source routes (tasks T053 to T055; contracts signals and sources).

export interface SignalRouteDeps {
  db: SqliteDatabase;
  signals: SignalService;
  reviews: ReviewService;
  sources: SourceService;
  authz: Authz;
  now?: () => Date;
}

const Id = z.object({ id: z.string().min(1).max(64) });
const Reliability = z.enum(["high", "medium", "low", "unknown"]);
const Confidence = z.enum(["low", "medium", "high"]);
const Link = z
  .object({
    entityType: z.enum(["evidence_reference", "icp_fit_assessment", "signal"]),
    entityId: z.string().min(1).max(64),
  })
  .strict();

const SignalInput = z
  .object({
    accountId: z.string().min(1).max(64),
    contactId: z.string().min(1).max(64).optional(),
    typeKey: z.string().min(1).max(80),
    observation: z.string().min(3).max(1000),
    excerpt: z.string().max(1000).optional(),
    observedAt: z.iso.datetime(),
    publishedAt: z.iso.datetime().optional(),
    source: z
      .object({
        sourceId: z.string().min(1).max(64).optional(),
        name: z.string().min(1).max(200).optional(),
        kind: z.enum(SOURCE_KINDS).optional(),
        ref: z.string().min(1).max(1000),
        itemKey: z.string().min(1).max(200).optional(),
      })
      .strict(),
    reliability: Reliability.optional(),
    extractionConfidence: Confidence.optional(),
    evidenceStatus: z
      .enum([
        "observed",
        "buyer_confirmed",
        "derived_interpretation",
        "ai_hypothesis",
        "unverified_assumption",
        "contradictory",
      ])
      .optional(),
    relevance: z
      .object({
        icp: z
          .array(z.enum(["icp1", "icp2"]))
          .max(2)
          .optional(),
        capability: z.array(z.string().max(60)).max(20).optional(),
        offer: z.array(z.string().max(60)).max(20).optional(),
      })
      .strict()
      .optional(),
    fundingClass: z.enum(["context", "budget_approval_evidence"]).optional(),
    approvalCitation: z.string().max(500).optional(),
    regulatoryItem: z.string().max(80).optional(),
    regulatoryStatus: z.enum(["proposed", "unverified", "reported_final"]).optional(),
    supports: z.array(Link).max(50).optional(),
    contradicts: z.array(Link).max(50).optional(),
  })
  .strict();

const Page = {
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
};
const FeedQuery = z.object({
  type: z.string().max(80).optional(),
  category: z.enum(["A", "B", "C", "D", "E", "F", "G", "H", "I"]).optional(),
  icp: z.enum(["icp1", "icp2"]).optional(),
  accountId: z.string().max(64).optional(),
  sourceId: z.string().max(64).optional(),
  capability: z.string().max(60).optional(),
  offer: z.string().max(60).optional(),
  confidence: Confidence.optional(),
  freshness: z.enum(["fresh", "stale", "undated"]).optional(),
  reviewStatus: z.enum(["pending", "approved", "rejected", "contradictory"]).optional(),
  ...Page,
});
const AccountQuery = z.object({
  currentOnly: z.enum(["true", "false"]).optional(),
  ...Page,
});
const ReviewBody = z
  .object({
    decision: z.enum(["approve", "reject", "contradict", "reverify", "clear_flag"]),
    reason: z.string().min(3).max(500).optional(),
    contradictsSignalId: z.string().max(64).optional(),
    reliability: Reliability.optional(),
  })
  .strict();
const SourceBody = z
  .object({ name: z.string().min(1).max(200), kind: z.enum(SOURCE_KINDS) })
  .strict();
const SourcePatch = z
  .object({
    storageRule: z.enum(["excerpt", "citation_only"]).optional(),
    excerptMaxChars: z.number().int().min(0).nullable().optional(),
    defaultReliability: Reliability.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field" });

export function registerSignalRoutes(app: FastifyInstance, deps: SignalRouteDeps): void {
  const { db, signals, reviews, sources, authz } = deps;
  const clock = deps.now ?? (() => new Date());
  const read = [authz.authenticate, authz.requirePermission("signals.read")];
  const record = [authz.authenticate, authz.requirePermission("signals.record")];
  const review = [authz.authenticate, authz.requirePermission("signals.review")];
  const manage = [authz.authenticate, authz.requirePermission("signals.sources.manage")];
  const sourceWriters = [
    authz.authenticate,
    authz.requireAnyPermission("signals.sources.manage", "signals.record"),
  ];
  const availability = [
    authz.authenticate,
    authz.requireAnyPermission("signals.review", "signals.sources.manage"),
  ];

  const actorOf = (request: {
    principal?: { userId: string; permissions: readonly string[] } | undefined;
    correlationId: string;
  }): SignalActor => ({
    userId: request.principal!.userId,
    actorType: "human",
    correlationId: request.correlationId || null,
    now: clock,
    canOverrideReliability: request.principal!.permissions.includes("signals.review"),
  });
  const guarded = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof SignalRefusal) throw toHttpError(error);
      throw error;
    }
  };

  app.post("/api/v1/signals", { preHandler: record }, async (request, reply) => {
    const body = parseOrThrow(SignalInput, request.body);
    const key = readIdempotencyKey(request);
    const result = signals.recordIdempotent(actorOf(request), body, key);
    const status = result.status === 201 && result.body.outcome !== "created" ? 200 : result.status;
    return reply.status(status).send(result.body);
  });

  app.get("/api/v1/signals", { preHandler: read }, async (request) => {
    const q = parseOrThrow(FeedQuery, request.query);
    return guarded(() => db.transaction((tx) => listSignals(tx, q, clock())));
  });

  app.get("/api/v1/signals/:id", { preHandler: read }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    return db.transaction((tx) => getSignalDetail(tx, id, clock()));
  });

  app.post("/api/v1/signals/:id/review", { preHandler: review }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const body = parseOrThrow(ReviewBody, request.body);
    readIdempotencyKey(request);
    return reviews.review(actorOf(request), id, body);
  });

  app.get("/api/v1/accounts/:id/signals", { preHandler: read }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const q = parseOrThrow(AccountQuery, request.query);
    return guarded(() =>
      db.transaction((tx) =>
        listAccountSignals(
          tx,
          id,
          { currentOnly: q.currentOnly === "true", cursor: q.cursor, limit: q.limit },
          clock(),
        ),
      ),
    );
  });

  app.get("/api/v1/signal-types", { preHandler: read }, async (request) => {
    const q = parseOrThrow(
      z.object({ version: z.coerce.number().int().min(1).optional() }),
      request.query,
    );
    return guarded(() => sources.listTypes(q.version));
  });

  app.get("/api/v1/signal-sources", { preHandler: read }, async () => ({ items: sources.list() }));

  app.post("/api/v1/signal-sources", { preHandler: sourceWriters }, async (request, reply) => {
    const body = parseOrThrow(SourceBody, request.body);
    readIdempotencyKey(request);
    return reply.status(201).send(sources.create(actorOf(request), body));
  });

  app.patch("/api/v1/signal-sources/:id", { preHandler: manage }, async (request) => {
    const { id } = parseOrThrow(Id, request.params);
    const body = parseOrThrow(SourcePatch, request.body);
    return sources.update(actorOf(request), id, body);
  });

  app.put(
    "/api/v1/signal-sources/:id/availability",
    { preHandler: availability },
    async (request) => {
      const { id } = parseOrThrow(Id, request.params);
      const body = parseOrThrow(
        z.object({ available: z.boolean(), reason: z.string().max(300).optional() }).strict(),
        request.body,
      );
      return sources.setAvailability(actorOf(request), id, body.available);
    },
  );
}
