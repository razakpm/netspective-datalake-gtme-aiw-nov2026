import type { SqliteDatabase } from "@gtm/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { parseOrThrow } from "../../http/errors.js";
import { readIdempotencyKey } from "../../http/idempotency.js";
import { catalogueActor, IdParam, mutate } from "../../platform/catalogue-routes.js";
import { ConvertSchema, type WorkshopService } from "./lifecycle-service.js";
import type { ArtifactService } from "./artifacts.js";
import type { BriefService } from "./brief.js";
import type { EffortService } from "./effort.js";
import type { FindingsService } from "./findings.js";
import type { OutputService } from "./output.js";
import type { SuggestService } from "./suggest.js";
import type { ParticipantService } from "./participants.js";

// Workshop routes (feature 007; contract workshops.openapi.yaml). Permissions are checked, and refusals
// audited, in the services. Nothing here sends a message or invites anyone.

export interface WorkshopRouteDeps {
  db: SqliteDatabase;
  workshops: WorkshopService;
  participants: ParticipantService;
  artifacts: ArtifactService;
  findings: FindingsService;
  suggest: SuggestService;
  briefs: BriefService;
  outputs: OutputService;
  effort: EffortService;
  artifactMaxBytes: number;
  authz: Authz;
  now?: () => Date;
}

const ParticipantParam = IdParam.extend({ participantId: z.string().min(1).max(100) });
const ArtifactParam = z.object({ artifactId: z.string().min(1).max(100) });
const BriefParam = IdParam.extend({ briefId: z.string().min(1).max(100) });

export function registerWorkshopRoutes(app: FastifyInstance, deps: WorkshopRouteDeps): void {
  const {
    db,
    workshops,
    participants,
    artifacts,
    findings,
    suggest,
    briefs,
    outputs,
    effort,
    authz,
  } = deps;
  const auth = { preHandler: [authz.authenticate] };
  const actor = (r: Parameters<typeof catalogueActor>[0]) => catalogueActor(r, deps.now);

  app.get("/api/v1/workshops", auth, async (request) => ({
    items: workshops.list(actor(request), request.query),
  }));
  app.post("/api/v1/workshops", auth, async (request, reply) => {
    const a = actor(request);
    const result = await mutate(db, request, "POST /workshops", request.body, 201, deps.now, () =>
      workshops.convert(a, parseOrThrow(ConvertSchema, request.body).requestId),
    );
    return reply.status(result.status).send(result.body);
  });
  app.get("/api/v1/workshops/:id", auth, async (request) =>
    workshops.get(actor(request), parseOrThrow(IdParam, request.params).id),
  );
  app.post("/api/v1/workshops/:id/transition", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /workshops/${id}/transition`,
      request.body,
      200,
      deps.now,
      () => workshops.transition(a, id, request.body),
    );
    return reply.status(result.status).send(result.body);
  });

  app.post("/api/v1/workshops/:id/participants", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /workshops/${id}/participants`,
      request.body,
      201,
      deps.now,
      () => participants.add(a, id, request.body),
    );
    return reply.status(result.status).send(result.body);
  });
  app.delete("/api/v1/workshops/:id/participants/:participantId", auth, async (request, reply) => {
    const { id, participantId } = parseOrThrow(ParticipantParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `DELETE /workshops/${id}/participants/${participantId}`,
      {},
      200,
      deps.now,
      () => participants.remove(a, id, participantId),
    );
    return reply.status(result.status).send(result.body);
  });

  app.get("/api/v1/workshops/:id/artifacts", auth, async (request) =>
    artifacts.list(actor(request), parseOrThrow(IdParam, request.params).id),
  );
  // The artifact service runs the boundary check itself, so that a flagged file is held, not rejected.
  app.post(
    "/api/v1/workshops/:id/artifacts",
    {
      ...auth,
      // JSON escaping can double the size of text; the service enforces the real limit.
      bodyLimit: deps.artifactMaxBytes * 2 + 16_384,
      config: { skipPhiGuard: true },
    },
    async (request, reply) => {
      const { id } = parseOrThrow(IdParam, request.params);
      const a = actor(request);
      const result = await mutate(
        db,
        request,
        `POST /workshops/${id}/artifacts`,
        request.body,
        201,
        deps.now,
        () => artifacts.record(a, id, request.body),
      );
      const held = result.status === 201 && (await result.body).state === "held";
      return reply.status(held ? 202 : result.status).send(result.body);
    },
  );
  app.post("/api/v1/workshop-artifacts/:artifactId/decision", auth, async (request, reply) => {
    const { artifactId } = parseOrThrow(ArtifactParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /workshop-artifacts/${artifactId}/decision`,
      request.body,
      200,
      deps.now,
      () => artifacts.decide(a, artifactId, request.body),
    );
    return reply.status(result.status).send(result.body);
  });
  app.get("/api/v1/workshop-artifacts/:artifactId/content", auth, async (request, reply) => {
    const { artifactId } = parseOrThrow(ArtifactParam, request.params);
    const file = await artifacts.content(actor(request), artifactId);
    // Always a download of plain text: a stored file is never rendered or cached.
    return reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename="${file.fileName}"`)
      .type("text/plain; charset=utf-8")
      .send(file.text);
  });

  app.get("/api/v1/workshops/:id/findings", auth, async (request) =>
    findings.get(actor(request), parseOrThrow(IdParam, request.params).id),
  );
  app.put("/api/v1/workshops/:id/findings", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `PUT /workshops/${id}/findings`,
      request.body,
      200,
      deps.now,
      () => findings.save(a, id, request.body),
    );
    return reply.status(result.status).send(result.body);
  });
  app.post("/api/v1/workshops/:id/findings/finalise", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /workshops/${id}/findings/finalise`,
      request.body ?? {},
      200,
      deps.now,
      () => findings.finalise(a, id, request.body ?? {}),
    );
    return reply.status(result.status).send(result.body);
  });
  // A suggestion is never stored, so its answer is not kept for replay either: the key is only checked.
  app.post("/api/v1/workshops/:id/findings/suggest", auth, async (request) => {
    const { id } = parseOrThrow(IdParam, request.params);
    readIdempotencyKey(request);
    return suggest.suggest(actor(request), id, request.body);
  });

  app.get("/api/v1/workshops/:id/brief", auth, async (request) =>
    briefs.get(actor(request), parseOrThrow(IdParam, request.params).id),
  );
  app.post("/api/v1/workshops/:id/brief", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(db, request, `POST /workshops/${id}/brief`, {}, 201, deps.now, () =>
      briefs.generate(a, id),
    );
    return reply.status(result.status).send(result.body);
  });
  app.post("/api/v1/workshops/:id/brief/:briefId/review", auth, async (request, reply) => {
    const { id, briefId } = parseOrThrow(BriefParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /workshops/${id}/brief/${briefId}/review`,
      {},
      200,
      deps.now,
      () => briefs.markReviewed(a, id, briefId),
    );
    return reply.status(result.status).send(result.body);
  });

  /** One route per output change: the same idempotency rule for each. */
  const change = (
    method: "post" | "put",
    path: string,
    status: number,
    run: (a: ReturnType<typeof actor>, id: string, body: unknown) => unknown,
  ) => {
    app[method](`/api/v1/workshops/:id/${path}`, auth, async (request, reply) => {
      const { id } = parseOrThrow(IdParam, request.params);
      const a = actor(request);
      const body = request.body ?? {};
      const result = await mutate(
        db,
        request,
        `${method.toUpperCase()} /workshops/${id}/${path}`,
        body,
        status,
        deps.now,
        () => run(a, id, body),
      );
      return reply.status(result.status).send(result.body);
    });
  };

  app.get("/api/v1/workshops/:id/output", auth, async (request) =>
    outputs.get(actor(request), parseOrThrow(IdParam, request.params).id),
  );
  change("post", "output", 201, (a, id) => outputs.generate(a, id));
  change("put", "output", 201, (a, id, body) => outputs.edit(a, id, body));
  change("post", "output/approve", 200, (a, id) => outputs.approve(a, id));
  change("post", "output/share", 201, (a, id, body) => outputs.share(a, id, body));
  app.get("/api/v1/workshops/:id/output/pdf", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const file = await outputs.pdf(actor(request), id);
    return reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename="${file.fileName}"`)
      .type("application/pdf")
      .send(file.bytes);
  });

  app.get("/api/v1/workshops/:id/effort", auth, async (request) =>
    effort.get(actor(request), parseOrThrow(IdParam, request.params).id),
  );
  change("post", "effort", 201, (a, id, body) => effort.record(a, id, body));
  app.get("/api/v1/workshop-effort-summary", auth, async (request) => ({
    items: effort.summary(actor(request)),
  }));
}
