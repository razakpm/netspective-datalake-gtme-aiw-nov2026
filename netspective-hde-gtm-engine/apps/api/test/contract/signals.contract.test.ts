import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

// Feature 003 contracts (tasks T051, T052): real responses are validated against
// specs/003-signals-evidence/contracts/{signals,sources}.openapi.yaml.
const signals = new Contract("signals.openapi.yaml", "003-signals-evidence");
const sources = new Contract("sources.openapi.yaml", "003-signals-evidence");

let fx: IdentityFixture;
let analyst: string;
let reviewer: string;
let admin: string;
let n = 0;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  analyst = (await fx.makeUser("analyst@example.org", ["research_analyst"])).token;
  reviewer = (await fx.makeUser("reviewer@example.org", ["technical_sme_reviewer"])).token;
  admin = (await fx.makeUser("admin@example.org", ["administrator"])).token;
  const now = new Date().toISOString();
  fx.db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('acc-1','Lakeshore','lakeshore',?,?)",
    )
    .run(now, now);
});
afterEach(async () => {
  await fx.app.close();
});

const call = (
  token: string,
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: unknown,
) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `contract-key-${++n}-padding` },
    payload: payload as object | undefined,
  });
const conforms = (c: Contract, path: string, method: string, res: LightMyRequestResponse) =>
  expect(
    c.check(path, method, res.statusCode, String(res.headers["content-type"]), res.json()),
  ).toEqual([]);

const input = (over: Record<string, unknown> = {}) => ({
  accountId: "acc-1",
  typeKey: "implementation_guide_change",
  observation: "The exchange published an updated implementation guide.",
  observedAt: "2026-11-10T00:00:00.000Z",
  publishedAt: "2026-11-09T00:00:00.000Z",
  source: { sourceId: "default-source-official_publication", ref: "https://example.org/ig/1" },
  extractionConfidence: "high",
  relevance: { icp: ["icp1"], capability: ["fhir_mapping"] },
  ...over,
});

describe("signals contract", () => {
  it("records, replays idempotently, merges, lists, reads, reviews and lists an account timeline", async () => {
    const created = await call(analyst, "POST", "/signals", input({ excerpt: "short quote" }));
    expect(created.statusCode).toBe(201);
    conforms(signals, "/signals", "post", created);
    expect(created.json().outcome).toBe("created");
    const id = created.json().signal.id as string;

    const again = await call(analyst, "POST", "/signals", input({ excerpt: "short quote" }));
    expect(again.statusCode).toBe(200);
    expect(again.json().outcome).toBe("already_exists");
    conforms(signals, "/signals", "post", again);

    const merged = await call(
      analyst,
      "POST",
      "/signals",
      input({ observation: "The exchange published an updated implementation guides." }),
    );
    expect(merged.statusCode).toBe(200);
    expect(merged.json().outcome).toBe("merged");
    conforms(signals, "/signals", "post", merged);

    const list = await call(
      reviewer,
      "GET",
      "/signals?type=implementation_guide_change&reviewStatus=pending&icp=icp1",
    );
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((s: { id: string }) => s.id)).toEqual([id]);
    conforms(signals, "/signals", "get", list);

    const detail = await call(reviewer, "GET", `/signals/${id}`);
    conforms(signals, "/signals/{id}", "get", detail);
    expect(detail.json().provenance).toHaveLength(2);

    const reviewed = await call(reviewer, "POST", `/signals/${id}/review`, { decision: "approve" });
    expect(reviewed.statusCode).toBe(200);
    conforms(signals, "/signals/{id}/review", "post", reviewed);
    expect(reviewed.json().isCurrent).toBe(true);

    const timeline = await call(analyst, "GET", "/accounts/acc-1/signals?currentOnly=true");
    expect(timeline.statusCode).toBe(200);
    conforms(signals, "/accounts/{id}/signals", "get", timeline);
    expect(timeline.json().items).toHaveLength(1);
  });

  it("answers problems for refusals, validation, missing and forbidden", async () => {
    const noSource = await call(
      analyst,
      "POST",
      "/signals",
      input({ source: { ref: "https://example.org/x" } }),
    );
    expect(noSource.statusCode).toBe(422);
    expect(noSource.json().detail).toContain("source_required");
    conforms(signals, "/signals", "post", noSource);
    const phi = await call(analyst, "POST", "/signals", input({ excerpt: "SSN 000-12-3456" }));
    expect(phi.statusCode).toBe(422);
    expect(phi.body).not.toContain("000-12-3456");
    const bad = await call(analyst, "POST", "/signals", { accountId: "acc-1" });
    expect(bad.statusCode).toBe(400);
    conforms(signals, "/signals", "post", bad);
    const missing = await call(analyst, "POST", "/signals", input({ accountId: "nope" }));
    expect(missing.statusCode).toBe(404);
    conforms(signals, "/signals", "post", missing);
    const forbidden = await call(analyst, "POST", "/signals/abc/review", { decision: "approve" });
    expect(forbidden.statusCode).toBe(403);
    const notFound = await call(reviewer, "GET", "/signals/nope");
    expect(notFound.statusCode).toBe(404);
    conforms(signals, "/signals/{id}", "get", notFound);
    const noReason = await call(
      reviewer,
      "POST",
      `/signals/${(await call(analyst, "POST", "/signals", input())).json().signal.id}/review`,
      { decision: "reject" },
    );
    expect(noReason.statusCode).toBe(400);
  });
});

describe("sources contract", () => {
  it("lists types and sources, creates, updates and marks availability", async () => {
    const types = await call(analyst, "GET", "/signal-types");
    expect(types.statusCode).toBe(200);
    conforms(sources, "/signal-types", "get", types);
    expect(types.json().version).toBe(1);
    expect(new Set(types.json().items.map((t: { category: string }) => t.category)).size).toBe(9);

    const list = await call(analyst, "GET", "/signal-sources");
    conforms(sources, "/signal-sources", "get", list);

    const created = await call(analyst, "POST", "/signal-sources", {
      name: "Regional bulletin",
      kind: "third_party",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().storageRule).toBe("citation_only");
    conforms(sources, "/signal-sources", "post", created);
    const dup = await call(analyst, "POST", "/signal-sources", {
      name: "Regional bulletin",
      kind: "third_party",
    });
    expect(dup.statusCode).toBe(409);
    conforms(sources, "/signal-sources", "post", dup);

    const id = created.json().id as string;
    const forbiddenPatch = await call(analyst, "PATCH", `/signal-sources/${id}`, {
      storageRule: "excerpt",
    });
    expect(forbiddenPatch.statusCode).toBe(403);
    const patched = await call(admin, "PATCH", `/signal-sources/${id}`, {
      storageRule: "excerpt",
      excerptMaxChars: 120,
    });
    expect(patched.statusCode).toBe(200);
    conforms(sources, "/signal-sources/{id}", "patch", patched);
    const tooLong = await call(admin, "PATCH", `/signal-sources/${id}`, { excerptMaxChars: 5000 });
    expect(tooLong.statusCode).toBe(422);

    const unavailable = await call(reviewer, "PUT", `/signal-sources/${id}/availability`, {
      available: false,
    });
    expect(unavailable.statusCode).toBe(200);
    expect(unavailable.json().availability).toBe("unavailable");
    conforms(sources, "/signal-sources/{id}/availability", "put", unavailable);
    const missing = await call(admin, "PATCH", "/signal-sources/nope", { excerptMaxChars: 1 });
    expect(missing.statusCode).toBe(404);
    conforms(sources, "/signal-sources/{id}", "patch", missing);
  });
});
