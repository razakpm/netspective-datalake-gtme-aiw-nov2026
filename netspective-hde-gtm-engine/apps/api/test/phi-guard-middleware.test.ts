import { afterEach, describe, expect, it } from "vitest";
import { CANARY_PHI } from "../../../packages/domain/test-support/canaries.js";
import type { PhiBlockEvent } from "../src/http/phi-guard.js";
import { buildTestServer, type TestServer } from "./helpers.js";

// Synthetic SSN in an invalid range (see tests/fixtures/phi-samples).
const SSN = "000-12-3456";

let server: TestServer;
let handlerRuns = 0;
const events: PhiBlockEvent[] = [];

async function start(options: { quarantine?: string[] } = {}): Promise<TestServer> {
  handlerRuns = 0;
  events.length = 0;
  server = await buildTestServer({
    ...(options.quarantine ? { guardPolicy: { quarantineEntryPoints: options.quarantine } } : {}),
    phiGuardSink: {
      onBlocked: (event) => {
        events.push(event);
      },
    },
    routes: (app) => {
      app.post("/echo", async () => {
        handlerRuns += 1;
        return { ok: true };
      });
      app.get("/search", async () => {
        handlerRuns += 1;
        return { ok: true };
      });
      app.post("/own-inspection", { config: { skipPhiGuard: true } }, async () => {
        handlerRuns += 1;
        return { ok: true };
      });
    },
  });
  return server;
}

afterEach(async () => {
  await server?.app.close();
});

function expectBlockedWithoutContent(res: {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
}) {
  expect(res.statusCode).toBe(422);
  expect(res.headers["content-type"]).toContain("application/problem+json");
  expect(res.body).not.toContain(SSN);
  expect(handlerRuns).toBe(0);
}

describe("PHI guard middleware", () => {
  it("blocks an SSN in a JSON body with a content-free 422", async () => {
    const { app } = await start();
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      payload: { note: `applicant ${SSN}` },
    });
    expectBlockedWithoutContent(res);
    expect(res.json()).toMatchObject({
      type: "urn:gtm:problem:phi-blocked",
      status: 422,
      ruleIds: ["PHI.SSN"],
      correlationId: res.headers["x-correlation-id"],
    });
  });

  it("blocks an SSN in a header", async () => {
    const { app } = await start();
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "x-note": `ssn ${SSN}` },
      payload: { ok: true },
    });
    expectBlockedWithoutContent(res);
  });

  it("blocks an SSN in the query string", async () => {
    const { app } = await start();
    const res = await app.inject({ method: "GET", url: `/search?q=${SSN}` });
    expectBlockedWithoutContent(res);
  });

  it("blocks PHI-like text with a name, MRN and date of birth", async () => {
    const { app } = await start();
    const res = await app.inject({ method: "POST", url: "/echo", payload: { text: CANARY_PHI } });
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toContain("Canaryfield");
  });

  it("lets benign requests through", async () => {
    const { app } = await start();
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      payload: { note: "Fields to trace: patient_id, mrn, dob, zip", date: "2026-03-14" },
    });
    expect(res.statusCode).toBe(200);
    expect(handlerRuns).toBe(1);
    expect(events).toHaveLength(0);
  });

  it("reports a content-free event to the sink", async () => {
    const { app } = await start();
    await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "x-correlation-id": "client-req-12345" },
      payload: { note: SSN },
    });
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event).toMatchObject({
      entryPoint: "api_body",
      action: "reject",
      parts: ["body"],
      correlationId: "client-req-12345",
      method: "POST",
      route: "/echo",
    });
    expect(event.decision.rule_ids).toEqual(["PHI.SSN"]);
    expect(JSON.stringify(event)).not.toContain(SSN);
  });

  it("never writes blocked content or the raw url to the logs", async () => {
    const { app, logs } = await start();
    await app.inject({ method: "GET", url: `/search?q=${SSN}` });
    await app.inject({ method: "POST", url: "/echo", payload: { text: CANARY_PHI } });
    const out = logs.join("");
    expect(out).not.toContain(SSN);
    expect(out).not.toContain("Canaryfield");
    expect(out).not.toContain("q=");
    expect(out).toContain("request blocked by PHI guard");
  });

  it("rejects at an entry point configured for quarantine when no holder is wired in", async () => {
    const { app } = await start({ quarantine: ["api_body"] });
    const res = await app.inject({ method: "POST", url: "/echo", payload: { note: SSN } });
    expect(res.statusCode).toBe(422);
    expect(events[0]?.action).toBe("quarantine");
    expect(handlerRuns).toBe(0);
  });

  it("does not inspect credential headers, which authentication handles", async () => {
    const { app } = await start();
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { authorization: "Bearer abcdefghijklmnopqrstuvwxyz0123456789" },
      payload: { ok: true },
    });
    expect(res.statusCode).toBe(200);
  });

  it("honours an explicit route-level opt-out for routes that inspect their own input", async () => {
    const { app } = await start();
    const res = await app.inject({
      method: "POST",
      url: "/own-inspection",
      payload: { note: SSN },
    });
    expect(res.statusCode).toBe(200);
  });
});
