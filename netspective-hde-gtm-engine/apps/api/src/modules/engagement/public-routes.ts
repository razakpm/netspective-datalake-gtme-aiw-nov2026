import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, parseOrThrow } from "../../http/errors.js";
import { signFormToken } from "./abuse.js";
import type { DeliveryService } from "./delivery.js";
import { isFormSlug } from "./public-forms.js";
import type { RequestService } from "./requests.js";

// The public group (feature 006, spec FR-016, FR-029, research R-08): no session, no cookie and no
// permission model, so everything it accepts is untrusted. Cross-origin calls are allowed only from the
// configured sites, each address is rate limited, and bodies are small. A refusal stores nothing.

export interface PublicRouteDeps {
  requests: RequestService;
  delivery: DeliveryService;
  formTokenKey: string;
  origins: string[];
  postLimitPerMinute: number;
  getLimitPerMinute: number;
  now?: () => Date;
}

const SlugParam = z.object({ slug: z.string().max(100) });
const TokenParam = z.object({ token: z.string().min(1).max(400) });
const BODY_LIMIT = 65_536;

export async function registerPublicRoutes(
  app: FastifyInstance,
  deps: PublicRouteDeps,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  await app.register(async (pub) => {
    await pub.register(cors, {
      origin: deps.origins.length > 0 ? deps.origins : false,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["content-type"],
      credentials: false,
      maxAge: 600,
    });
    await pub.register(rateLimit, {
      global: false,
      keyGenerator: (request) => request.ip,
      errorResponseBuilder: () =>
        new HttpError(
          429,
          "Too many requests",
          "Too many requests. Please wait a minute and try again.",
          {
            codes: ["rate_limited"],
          },
        ),
    });
    // A browser on a site that is not on the list is refused here; a server-side caller sends no Origin.
    pub.addHook("onRequest", async (request) => {
      const origin = request.headers.origin;
      if (typeof origin === "string" && !deps.origins.includes(origin)) {
        throw new HttpError(
          403,
          "Origin not allowed",
          "This site is not allowed to use this form.",
          {
            codes: ["origin_not_allowed"],
          },
        );
      }
    });

    const slugOf = (params: unknown) => {
      const { slug } = parseOrThrow(SlugParam, params);
      if (!isFormSlug(slug)) throw new HttpError(404, "Not found");
      return slug;
    };

    pub.get(
      "/api/v1/public/offers/:slug/form",
      { config: { rateLimit: { max: deps.getLimitPerMinute, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const slug = slugOf(request.params);
        void reply.header("cache-control", "no-store");
        return deps.requests.formFor(slug, now(), (s, at) =>
          signFormToken(deps.formTokenKey, s, at),
        );
      },
    );

    pub.post(
      "/api/v1/public/offers/:slug/requests",
      {
        bodyLimit: BODY_LIMIT,
        config: { rateLimit: { max: deps.postLimitPerMinute, timeWindow: "1 minute" } },
      },
      async (request, reply) => {
        const slug = slugOf(request.params);
        const receipt = await deps.requests.submit(slug, request.body, {
          correlationId: request.correlationId || null,
          now: now(),
        });
        void reply.header("cache-control", "no-store");
        return reply.status(201).send(receipt);
      },
    );

    pub.get(
      "/api/v1/public/downloads/:token",
      {
        // The token is a signed value checked by the handler; random characters in it must not trip the
        // content guard. No content is stored from this route.
        config: {
          skipPhiGuard: true,
          rateLimit: { max: deps.getLimitPerMinute, timeWindow: "1 minute" },
        },
      },
      async (request, reply) => {
        const { token } = parseOrThrow(TokenParam, request.params);
        const result = await deps.delivery.open(token, now());
        if (!result.ok) {
          if (result.code === "expired") {
            throw new HttpError(
              410,
              "Link expired",
              "This link has expired. You can ask for a new one on the form.",
              {
                codes: ["link_expired"],
              },
            );
          }
          throw new HttpError(404, "Not found");
        }
        return reply
          .header("content-type", result.file.contentType)
          .header("content-length", result.file.size)
          .header("content-disposition", `attachment; filename="${result.key}"`)
          .header("cache-control", "no-store")
          .send(result.file.stream);
      },
    );
  });
}
