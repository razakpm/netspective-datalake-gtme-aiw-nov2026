import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

// Feature 002 accounts and review contracts (tasks T021, T034). Real responses are validated against
// specs/002-accounts-contacts-icp/contracts/*.openapi.yaml.
const accounts = new Contract("accounts.openapi.yaml", "002-accounts-contacts-icp");
const review = new Contract("review.openapi.yaml", "002-accounts-contacts-icp");
const FIXTURES = join(import.meta.dirname, "../../../../tests/fixtures/synthetic-orgs");
const csv = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

let fx: IdentityFixture;
let token: string;
let n = 0;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  token = (await fx.makeUser("operator@example.org", ["gtm_operator"])).token;
});
afterEach(async () => {
  await fx.app.close();
});

const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, csvBody?: string) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": `contract-key-${++n}-padding`,
      ...(csvBody !== undefined ? { "content-type": "text/csv" } : {}),
    },
    payload: csvBody ?? (payload as object | undefined),
  });
const conforms = (
  c: Contract,
  path: string,
  method: string,
  res: LightMyRequestResponse,
  status = res.statusCode,
) =>
  expect(c.check(path, method, status, String(res.headers["content-type"]), res.json())).toEqual(
    [],
  );

describe("accounts and review contracts", () => {
  it("import, dry run, import run, list, detail and update conform", async () => {
    const dry = await call(
      "POST",
      "/accounts/import?dry_run=true",
      undefined,
      csv("organisations.csv"),
    );
    expect(dry.statusCode).toBe(200);
    conforms(accounts, "/accounts/import", "post", dry);

    const imported = await call("POST", "/accounts/import", undefined, csv("organisations.csv"));
    expect(imported.statusCode).toBe(201);
    conforms(accounts, "/accounts/import", "post", imported);

    const run = await call("GET", `/import-runs/${imported.json().id}`);
    conforms(accounts, "/import-runs/{id}", "get", run);

    const list = await call("GET", "/accounts");
    conforms(accounts, "/accounts", "get", list);
    const id = list.json().items[0].id;
    conforms(accounts, "/accounts/{id}", "get", await call("GET", `/accounts/${id}`));
    const patched = await call("PATCH", `/accounts/${id}`, { geography: "Somewhere" });
    conforms(accounts, "/accounts/{id}", "patch", patched);

    const rejected = await call("POST", "/accounts/import", undefined, "name,kind\nA,b\n");
    expect(rejected.statusCode).toBe(422);
    conforms(accounts, "/accounts/import", "post", rejected);
    conforms(accounts, "/accounts/{id}", "get", await call("GET", "/accounts/nope"), 404);
  });

  it("review queue list, detail and decision conform", async () => {
    await call("POST", "/accounts/import", undefined, csv("organisations.csv"));
    await call("POST", "/accounts/import", undefined, csv("organisations-duplicates.csv"));
    const list = await call("GET", "/review-items");
    conforms(review, "/review-items", "get", list);
    const id = list.json().items[0].id;
    conforms(review, "/review-items/{id}", "get", await call("GET", `/review-items/${id}`));
    const decided = await call("POST", `/review-items/${id}/decision`, {
      decision: "reject",
      reason: "Different organisations",
    });
    expect(decided.statusCode).toBe(200);
    conforms(review, "/review-items/{id}/decision", "post", decided);
  });
});
