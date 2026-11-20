import type { SqliteDatabase } from "@gtm/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";
import { catalogueActor, IdParam, mutate } from "../../platform/catalogue-routes.js";
import type { CheckResult } from "./queries.js";
import type { ClaimReviewService } from "./review.js";
import type { ClaimDetailView, ClaimService } from "./service.js";

// Claim routes (feature 005; contract claims.openapi.yaml). Permissions are checked, and refusals audited,
// in the services.

export interface ClaimRouteDeps {
  db: SqliteDatabase;
  claims: ClaimService;
  review: ClaimReviewService;
  authz: Authz;
  now?: () => Date;
}

const Lint = z.object({ text: z.string().max(20_000) }).strict();
const Status = z.enum(["draft", "in_review", "approved", "rejected", "withdrawn", "needs_review"]);

/** The contract names the rule `ruleId`. */
export const lintOut = (r: CheckResult) => ({
  listVersion: r.listVersion,
  matches: r.matches.map(({ rule, ...m }) => ({ ...m, ruleId: rule })),
});
const claimOut = (c: ClaimDetailView) => ({ ...c, lint: lintOut(c.lint) });

export function registerClaimRoutes(app: FastifyInstance, deps: ClaimRouteDeps): void {
  const { db, claims, review, authz } = deps;
  const auth = { preHandler: [authz.authenticate] };
  const actor = (r: Parameters<typeof catalogueActor>[0]) => catalogueActor(r, deps.now);

  app.get("/api/v1/claims", auth, async (request) => {
    const q = parseOrThrow(z.object({ status: Status.optional() }), request.query);
    return { items: claims.list(actor(request), q.status ? { status: q.status } : {}) };
  });
  app.post("/api/v1/claims", auth, async (request, reply) => {
    const a = actor(request);
    const result = await mutate(db, request, "POST /claims", request.body, 201, deps.now, () =>
      claimOut(claims.draft(a, request.body)),
    );
    return reply.status(result.status).send(result.body);
  });
  app.post("/api/v1/claims/lint", auth, async (request) => {
    const body = parseOrThrow(Lint, request.body);
    return lintOut(claims.lint(actor(request), body.text));
  });
  app.post("/api/v1/claims/dispositions", auth, async (request, reply) => {
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      "POST /claims/dispositions",
      request.body,
      201,
      deps.now,
      () => ({
        id: review.markFalsePositive(a, request.body),
      }),
    );
    return reply.status(result.status).send(result.body);
  });
  app.get("/api/v1/claims/:id", auth, async (request) =>
    claimOut(claims.get(actor(request), parseOrThrow(IdParam, request.params).id)),
  );
  app.post("/api/v1/claims/:id/evidence", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /claims/${id}/evidence`,
      request.body,
      201,
      deps.now,
      () => claimOut(claims.addEvidence(a, id, request.body)),
    );
    return reply.status(result.status).send(result.body);
  });
  app.post("/api/v1/claims/:id/evidence/:evidenceId/withdraw", auth, async (request, reply) => {
    const { id, evidenceId } = parseOrThrow(
      IdParam.extend({ evidenceId: z.string().min(1).max(100) }),
      request.params,
    );
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /claims/${id}/evidence/${evidenceId}/withdraw`,
      null,
      200,
      deps.now,
      () => claimOut(review.withdrawEvidence(a, id, evidenceId)),
    );
    return reply.status(200).send(result.body);
  });
  app.post("/api/v1/claims/:id/review", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /claims/${id}/review`,
      request.body,
      200,
      deps.now,
      () => claimOut(review.review(a, id, request.body)),
    );
    return reply.status(200).send(result.body);
  });
  app.post("/api/v1/claims/:id/withdraw", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /claims/${id}/withdraw`,
      request.body,
      200,
      deps.now,
      () => claimOut(review.withdraw(a, id, request.body)),
    );
    return reply.status(200).send(result.body);
  });

  app.get("/api/v1/restricted-phrases", auth, async (request) =>
    review.getPhraseList(actor(request)),
  );
  app.put("/api/v1/restricted-phrases", auth, async (request, reply) => {
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      "PUT /restricted-phrases",
      request.body,
      201,
      deps.now,
      () => review.publishPhraseList(a, request.body),
    );
    return reply.status(result.status).send(result.body);
  });
}
