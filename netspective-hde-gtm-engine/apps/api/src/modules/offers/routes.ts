import type { SqliteDatabase } from "@gtm/db";
import { missingRequiredFields, periodForLocalDate } from "@gtm/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authz } from "../../http/authz.js";
import { HttpError, parseOrThrow } from "../../http/errors.js";
import { catalogueActor, IdParam, mutate } from "../../platform/catalogue-routes.js";
import type { BookingService } from "./bookings.js";
import type { CapacityService } from "./capacity.js";
import type { OfferLimitations } from "./limitations.js";
import type { PaidTypeService } from "./paid-types.js";
import type { LimitationView, OfferSummary, VersionView } from "./queries.js";
import type { ScoreService } from "./scores.js";
import type { OfferDetail, OfferService } from "./service.js";
import type { OfferStatusService } from "./status.js";

// Offer routes (feature 005; contract offers.openapi.yaml): offers, versions, status moves, limitations,
// capacity, bookings, scores and paid engagement types. Permissions are checked, and refusals audited, in
// the services.

export interface OfferRouteDeps {
  db: SqliteDatabase;
  offers: OfferService;
  status: OfferStatusService;
  limitations: OfferLimitations;
  capacity: CapacityService;
  bookings: BookingService;
  scores: ScoreService;
  paidTypes: PaidTypeService;
  authz: Authz;
  now?: () => Date;
}

const versionOut = (v: VersionView) => ({
  ...v,
  placeholderAttributes: missingRequiredFields(v.snapshot),
});

export function registerOfferRoutes(app: FastifyInstance, deps: OfferRouteDeps): void {
  const { db, offers, status, limitations, capacity, bookings, scores, paidTypes, authz } = deps;
  const clock = deps.now ?? (() => new Date());
  const auth = { preHandler: [authz.authenticate] };
  const actor = (r: Parameters<typeof catalogueActor>[0]) => catalogueActor(r, deps.now);
  const withCapacity = <T extends OfferSummary>(o: T) => ({
    ...o,
    capacity: capacity.capacityStatus(o.id, clock()),
  });
  const detailOut = (d: OfferDetail) => ({
    ...withCapacity(d),
    latest: versionOut(d.latest),
    inForce: d.inForce ? versionOut(d.inForce) : null,
    limitations: d.limitations,
  });

  app.get("/api/v1/offers", auth, async (request) => ({
    items: offers.list(actor(request)).map(withCapacity),
  }));
  app.get("/api/v1/offers/:id", auth, async (request) =>
    detailOut(offers.get(actor(request), parseOrThrow(IdParam, request.params).id)),
  );
  app.patch("/api/v1/offers/:id", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const body = parseOrThrow(
      z.object({ lockNo: z.number().int().min(1) }).passthrough(),
      request.body,
    );
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `PATCH /offers/${id}`,
      request.body,
      201,
      deps.now,
      () => {
        offers.createVersion(
          a,
          id,
          {
            patch: (request.body as { patch?: unknown }).patch,
            reason: (request.body as { reason?: unknown }).reason,
          },
          body.lockNo,
        );
        return detailOut(offers.get(a, id));
      },
    );
    return reply.status(result.status).send(result.body);
  });
  app.get("/api/v1/offers/:id/versions", auth, async (request) => ({
    items: offers
      .listVersions(actor(request), parseOrThrow(IdParam, request.params).id)
      .map(versionOut),
  }));
  app.post("/api/v1/offers/:id/versions/:versionNo/status", auth, async (request, reply) => {
    const { id, versionNo } = parseOrThrow(
      IdParam.extend({ versionNo: z.coerce.number().int().min(1) }),
      request.params,
    );
    const body = parseOrThrow(
      z
        .object({
          to: z.enum([
            "draft",
            "internally_reviewed",
            "approved",
            "available",
            "withdrawn",
            "expired",
          ]),
          note: z.string().min(3).max(300),
        })
        .strict(),
      request.body,
    );
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /offers/${id}/versions/${versionNo}/status`,
      body,
      200,
      deps.now,
      () => versionOut(status.moveStatus(a, id, versionNo, body.to, body.note)),
    );
    return reply.status(200).send(result.body);
  });
  app.post(
    "/api/v1/offers/:id/limitations/:limitationId/acknowledge",
    auth,
    async (request, reply) => {
      const { id, limitationId } = parseOrThrow(
        IdParam.extend({ limitationId: z.string().min(1).max(100) }),
        request.params,
      );
      const a = actor(request);
      const result = await mutate(
        db,
        request,
        `POST /offers/${id}/limitations/${limitationId}/acknowledge`,
        null,
        200,
        deps.now,
        (): LimitationView => {
          const owner = db.raw
            .prepare("SELECT offer_id FROM offer_limitation WHERE id = ?")
            .get(limitationId) as { offer_id: string } | undefined;
          if (!owner || owner.offer_id !== id) throw new HttpError(404, "Limitation not found");
          return limitations.acknowledge(a, limitationId);
        },
      );
      return reply.status(200).send(result.body);
    },
  );

  const capacityOut = (a: ReturnType<typeof actor>, id: string) => ({
    current: capacity.statusFor(a, id, clock()),
    history: capacity.listLimits(a, id),
  });
  app.get("/api/v1/offers/:id/capacity", auth, async (request) =>
    capacityOut(actor(request), parseOrThrow(IdParam, request.params).id),
  );
  app.put("/api/v1/offers/:id/capacity", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `PUT /offers/${id}/capacity`,
      request.body,
      200,
      deps.now,
      () => {
        capacity.setLimit(a, id, request.body);
        return capacityOut(a, id);
      },
    );
    return reply.status(200).send(result.body);
  });
  app.get("/api/v1/offers/:id/capacity/status", auth, async (request) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const q = parseOrThrow(z.object({ at: z.string().datetime().optional() }), request.query);
    return capacity.statusFor(actor(request), id, q.at ? new Date(q.at) : clock());
  });

  app.get("/api/v1/offers/:id/bookings", auth, async (request) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const q = parseOrThrow(
      z.object({
        periodStart: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
      request.query,
    );
    const a = actor(request);
    const current = capacity.statusFor(a, id, clock());
    const kind = current.periodKind ?? "month";
    const period = periodForLocalDate(q.periodStart ?? (current.periodStart as string), kind);
    return {
      items: bookings
        .list(a, id)
        .filter((b) => b.sessionDate >= period.start && b.sessionDate < period.end),
    };
  });
  app.post("/api/v1/offers/:id/bookings", auth, async (request, reply) => {
    const { id } = parseOrThrow(IdParam, request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /offers/${id}/bookings`,
      request.body,
      201,
      deps.now,
      () => bookings.record(a, id, request.body),
    );
    return reply.status(result.status).send(result.body);
  });
  app.patch("/api/v1/offers/:id/bookings/:bookingId", auth, async (request, reply) => {
    const { id, bookingId } = parseOrThrow(
      IdParam.extend({ bookingId: z.string().min(1).max(100) }),
      request.params,
    );
    const body = parseOrThrow(
      z
        .object({
          state: z.enum(["held", "cancelled", "no_show"]).optional(),
          sessionDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .strict()
        .refine((b) => (b.state === undefined) !== (b.sessionDate === undefined), {
          message: "send either a state or a session date",
        }),
      request.body,
    );
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `PATCH /offers/${id}/bookings/${bookingId}`,
      body,
      200,
      deps.now,
      () => {
        const owner = db.raw
          .prepare("SELECT offer_id FROM offer_session_booking WHERE id = ?")
          .get(bookingId) as { offer_id: string } | undefined;
        if (!owner || owner.offer_id !== id) throw new HttpError(404, "Booking not found");
        if (body.sessionDate !== undefined)
          return bookings.reschedule(a, bookingId, body.sessionDate);
        if (body.state === "held") return bookings.markHeld(a, bookingId);
        if (body.state === "no_show") return bookings.markNoShow(a, bookingId);
        return bookings.cancel(a, bookingId);
      },
    );
    return reply.status(200).send(result.body);
  });

  const scoresOut = (a: ReturnType<typeof actor>) => ({
    label: "Judgement scores: every score is a hypothesis until the business confirms it.",
    ...scores.list(a),
  });
  app.get("/api/v1/offer-scores", auth, async (request) => scoresOut(actor(request)));
  app.put("/api/v1/offer-scores", auth, async (request, reply) => {
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      "PUT /offer-scores",
      request.body,
      200,
      deps.now,
      () => {
        scores.setScore(a, request.body);
        return scoresOut(a);
      },
    );
    return reply.status(200).send(result.body);
  });

  app.get("/api/v1/paid-engagement-types", auth, async (request) => ({
    items: paidTypes.list(actor(request)),
  }));
  app.patch("/api/v1/paid-engagement-types/:key", auth, async (request, reply) => {
    const { key } = parseOrThrow(z.object({ key: z.string().min(1).max(100) }), request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `PATCH /paid-engagement-types/${key}`,
      request.body,
      200,
      deps.now,
      () => paidTypes.update(a, key, request.body),
    );
    return reply.status(200).send(result.body);
  });
  app.post("/api/v1/paid-engagement-types/:key/deliverables", auth, async (request, reply) => {
    const { key } = parseOrThrow(z.object({ key: z.string().min(1).max(100) }), request.params);
    const a = actor(request);
    const result = await mutate(
      db,
      request,
      `POST /paid-engagement-types/${key}/deliverables`,
      request.body,
      201,
      deps.now,
      () => paidTypes.proposeDeliverable(a, key, request.body),
    );
    return reply.status(result.status).send(result.body);
  });
  app.post(
    "/api/v1/paid-engagement-types/:key/deliverables/:deliverableId/decision",
    auth,
    async (request, reply) => {
      const { key, deliverableId } = parseOrThrow(
        z.object({ key: z.string().min(1).max(100), deliverableId: z.string().min(1).max(100) }),
        request.params,
      );
      const a = actor(request);
      const result = await mutate(
        db,
        request,
        `POST /paid-engagement-types/${key}/deliverables/${deliverableId}/decision`,
        request.body,
        200,
        deps.now,
        () => paidTypes.decideDeliverable(a, key, deliverableId, request.body),
      );
      return reply.status(200).send(result.body);
    },
  );
}
