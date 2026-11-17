import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { parseOrThrow } from "../src/http/errors.js";
import { buildOpenApiDocument } from "../src/http/openapi.js";
import { clearRegisteredSecrets, registerSecret } from "../src/logging/logger.js";
import { CANARY_SECRET } from "../../../packages/domain/test-support/canaries.js";
import { buildTestServer, type TestServer } from "./helpers.js";

let server: TestServer;
let handlerRuns = 0;

async function start(env: Record<string, string> = {}): Promise<TestServer> {
  server = await buildTestServer({
    env,
    routes: (app) => {
      app.post("/echo", async () => {
        handlerRuns += 1;
        return { ok: true };
      });
      app.post("/validated", async (request) =>
        parseOrThrow(z.object({ name: z.string().min(2), age: z.number().int() }), request.body),
      );
      app.get("/boom", async () => {
        throw new Error(`internal detail ${CANARY_SECRET}`);
      });
    },
  });
  return server;
}

beforeEach(() => {
  handlerRuns = 0;
  registerSecret(CANARY_SECRET);
});

afterEach(async () => {
  clearRegisteredSecrets();
  await server?.app.close();
});

describe("HTTP server skeleton", () => {
  it("rejects an oversized request with 413 before any handler runs, and nothing leaks", async () => {
    const { app } = await start({ API_BODY_LIMIT_BYTES: "1024" });
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ filler: "x".repeat(5_000) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      title: "Payload too large",
      status: 413,
      correlationId: res.headers["x-correlation-id"],
    });
    expect(res.body).not.toContain("xxxxx");
    expect(handlerRuns).toBe(0);
  });

  it("answers a validation failure with problem+json naming fields, never values", async () => {
    const { app } = await start();
    const res = await app.inject({
      method: "POST",
      url: "/validated",
      payload: { name: "x", age: "not-a-number-secret-value" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toMatchObject({ title: "Request validation failed", status: 400 });
    expect(body.correlationId).toBe(res.headers["x-correlation-id"]);
    expect(body.detail).toContain("name");
    expect(body.detail).toContain("age");
    expect(res.body).not.toContain("not-a-number-secret-value");
  });

  it("accepts a valid request", async () => {
    const { app } = await start();
    const res = await app.inject({
      method: "POST",
      url: "/validated",
      payload: { name: "Pat", age: 41 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "Pat", age: 41 });
  });

  it("answers malformed JSON with a generic 400 that does not echo the body", async () => {
    const { app } = await start();
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: '{"broken": "echo-me-back"',
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.body).not.toContain("echo-me-back");
  });

  it("answers an unknown route with a 404 problem", async () => {
    const { app } = await start();
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ title: "Not found", status: 404 });
    expect(res.json().correlationId).toBe(res.headers["x-correlation-id"]);
  });

  it("hides internals on an unexpected error and scrubs the log", async () => {
    const { app, logs } = await start();
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ title: "Internal server error", status: 500 });
    expect(res.body).not.toContain("internal detail");
    expect(res.body).not.toContain(CANARY_SECRET);
    expect(logs.join("")).toContain("unhandled error");
    expect(logs.join("")).not.toContain(CANARY_SECRET);
  });
});

describe("OpenAPI document", () => {
  it("is OpenAPI 3.1 and includes the shared Problem schema", () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components?.schemas).toHaveProperty("Problem");
  });
});
