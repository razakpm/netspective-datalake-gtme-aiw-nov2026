import { afterEach, describe, expect, it } from "vitest";
import { getCorrelationId } from "../src/context.js";
import { buildTestServer, type TestServer } from "./helpers.js";

let server: TestServer;

async function start(): Promise<TestServer> {
  server = await buildTestServer({
    routes: (app) => {
      app.get("/whoami", async (request) => ({
        fromRequest: request.correlationId,
        fromContext: getCorrelationId(),
      }));
      app.get("/slow/:ms", async (request) => {
        const ms = Number((request.params as { ms: string }).ms);
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { id: getCorrelationId() };
      });
    },
  });
  return server;
}

afterEach(async () => {
  await server?.app.close();
});

describe("correlation id middleware", () => {
  it("generates an id when none is sent and returns it in the response", async () => {
    const { app } = await start();
    const res = await app.inject({ method: "GET", url: "/whoami" });
    const id = res.headers["x-correlation-id"] as string;
    expect(id).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    expect(res.json()).toEqual({ fromRequest: id, fromContext: id });
  });

  it("preserves a well-formed inbound id", async () => {
    const { app } = await start();
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { "x-correlation-id": "client-req-12345" },
    });
    expect(res.headers["x-correlation-id"]).toBe("client-req-12345");
    expect(res.json()).toEqual({
      fromRequest: "client-req-12345",
      fromContext: "client-req-12345",
    });
  });

  it.each([
    ["too short", "abc"],
    ["too long", "a".repeat(65)],
    ["contains a space", "abcd efgh"],
    ["contains a quote", 'abcdefgh"x'],
  ])("replaces a malformed inbound id: %s", async (_label, bad) => {
    const { app } = await start();
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { "x-correlation-id": bad },
    });
    const id = res.headers["x-correlation-id"] as string;
    expect(id).not.toBe(bad);
    expect(id).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
  });

  it("keeps ids separate across concurrent requests", async () => {
    const { app } = await start();
    const [a, b] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/slow/40",
        headers: { "x-correlation-id": "request-aaaaaaaa" },
      }),
      app.inject({
        method: "GET",
        url: "/slow/5",
        headers: { "x-correlation-id": "request-bbbbbbbb" },
      }),
    ]);
    expect(a.json()).toEqual({ id: "request-aaaaaaaa" });
    expect(b.json()).toEqual({ id: "request-bbbbbbbb" });
  });

  it("puts the id in the request log line without logging the raw url", async () => {
    const { app, logs } = await start();
    await app.inject({
      method: "GET",
      url: "/whoami?note=query-string-text",
      headers: { "x-correlation-id": "client-req-12345" },
    });
    const completed = logs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === "request completed");
    expect(completed).toMatchObject({
      correlationId: "client-req-12345",
      route: "/whoami",
      statusCode: 200,
    });
    expect(logs.join("")).not.toContain("query-string-text");
  });
});
