import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Problem } from "@gtm/domain";
import type { ZodError, ZodType } from "zod";

// Every error leaves the API as application/problem+json with the correlation ID (see contracts).
// `detail` is written by us and never echoes request content, secrets or blocked content.

export class HttpError extends Error {
  readonly status: number;
  readonly title: string;
  readonly problemType: string;
  readonly ruleIds: string[] | undefined;
  readonly codes: string[] | undefined;

  constructor(
    status: number,
    title: string,
    detail?: string,
    options: { type?: string; ruleIds?: string[]; codes?: string[] } = {},
  ) {
    super(detail ?? title);
    this.name = "HttpError";
    this.status = status;
    this.title = title;
    this.problemType = options.type ?? "about:blank";
    this.ruleIds = options.ruleIds;
    this.codes = options.codes;
  }
}

function fieldPaths(error: ZodError): string {
  const paths = new Set(error.issues.map((issue) => issue.path.join(".") || "(body)"));
  return [...paths].join(", ");
}

/** Validate untrusted input with a Zod schema; throws a 400 that names fields, never values. */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      400,
      "Request validation failed",
      `Invalid fields: ${fieldPaths(result.error)}`,
    );
  }
  return result.data;
}

export function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  problem: Omit<Problem, "correlationId">,
): FastifyReply {
  const body: Problem = { ...problem, correlationId: request.correlationId || "unknown" };
  return reply.status(problem.status).type("application/problem+json").send(body);
}

function fromFastifyError(error: FastifyError): Omit<Problem, "correlationId"> | undefined {
  switch (error.code) {
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return { type: "about:blank", title: "Payload too large", status: 413 };
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return { type: "about:blank", title: "Unsupported media type", status: 415 };
    default:
      break;
  }
  const status = error.statusCode;
  if (status !== undefined && status >= 400 && status < 500) {
    return { type: "about:blank", title: "Bad request", status };
  }
  return undefined;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, { type: "about:blank", title: "Not found", status: 404 }),
  );

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof HttpError) {
      return sendProblem(request, reply, {
        type: error.problemType,
        title: error.title,
        status: error.status,
        ...(error.message !== error.title ? { detail: error.message } : {}),
        ...(error.ruleIds ? { ruleIds: error.ruleIds } : {}),
        ...(error.codes ? { codes: error.codes } : {}),
      });
    }

    const mapped = fromFastifyError(error as FastifyError);
    if (mapped) return sendProblem(request, reply, mapped);

    // Unexpected failure: log it (the logger scrubs registered secrets) and return nothing internal.
    request.log.error({ err: error }, "unhandled error");
    return sendProblem(request, reply, {
      type: "about:blank",
      title: "Internal server error",
      status: 500,
    });
  });
}
