import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PHRASE_RULES } from "@gtm/domain";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

// Task T059: real responses are validated against specs/005-capabilities-offers-claims/contracts/claims.openapi.yaml.
const contract = new Contract("claims.openapi.yaml", "005-capabilities-offers-claims");
let fx: IdentityFixture;
let t: { drafter: string; lead: string; marketing: string; reader: string };
let leadId: string;
let n = 0;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  const lead = await fx.makeUser("lead@example.org", ["sales_service_lead"]);
  leadId = lead.id;
  t = {
    drafter: (await fx.makeUser("drafter@example.org", ["research_analyst"])).token,
    lead: lead.token,
    marketing: (await fx.makeUser("marketing@example.org", ["campaign_approver"])).token,
    reader: (await fx.makeUser("reader@example.org", ["read_only_executive"])).token,
  };
});
afterEach(async () => {
  await fx.app.close();
});
const call = (token: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `contract-key-${++n}-padding` },
    payload: payload as object | undefined,
  });
const conforms = (path: string, method: string, res: LightMyRequestResponse) =>
  expect(
    contract.check(path, method, res.statusCode, String(res.headers["content-type"]), res.json()),
  ).toEqual([]);
const draft = async (text = "We reduced rejections by 40% last year.") => {
  const res = await call(t.drafter, "POST", "/claims", { text });
  return { res, id: (res.json() as { id: string }).id };
};
const evidence = (id: string) =>
  call(t.drafter, "POST", `/claims/${id}/evidence`, {
    kind: "document",
    reference: "report-1",
    owner: "Service lead",
  });

describe("claims", () => {
  it("POST /claims, GET /claims and GET /claims/{id}", async () => {
    const { res, id } = await draft();
    expect(res.statusCode).toBe(201);
    conforms("/claims", "POST", res);
    const list = await call(t.reader, "GET", "/claims?status=draft");
    expect(list.statusCode).toBe(200);
    conforms("/claims", "GET", list);
    const one = await call(t.reader, "GET", `/claims/${id}`);
    expect(one.statusCode).toBe(200);
    conforms("/claims/{id}", "GET", one);
    expect(
      (one.json() as { lint: { matches: { ruleId: string }[] } }).lint.matches[0]?.ruleId,
    ).toBe("outcome-percentage");
  });

  it("evidence, review, evidence withdrawal and withdrawal", async () => {
    const { id } = await draft();
    const ev = await evidence(id);
    expect(ev.statusCode).toBe(201);
    conforms("/claims/{id}/evidence", "POST", ev);
    const review = await call(t.lead, "POST", `/claims/${id}/review`, {
      decision: "approve",
      note: "Checked the evidence",
    });
    expect(review.statusCode).toBe(200);
    conforms("/claims/{id}/review", "POST", review);
    const evidenceId = (ev.json() as { evidence: { id: string }[] }).evidence[0]!.id;
    const withdrawn = await call(t.lead, "POST", `/claims/${id}/evidence/${evidenceId}/withdraw`);
    expect(withdrawn.statusCode).toBe(200);
    conforms("/claims/{id}/evidence/{evidenceId}/withdraw", "POST", withdrawn);
    const other = await draft("We review sender feeds weekly.");
    const gone = await call(t.drafter, "POST", `/claims/${other.id}/withdraw`, {
      note: "Not needed now",
    });
    expect(gone.statusCode).toBe(200);
    conforms("/claims/{id}/withdraw", "POST", gone);
  });

  it("POST /claims/lint and POST /claims/dispositions", async () => {
    const lint = await call(t.reader, "POST", "/claims/lint", { text: "We guarantee an SLA." });
    expect(lint.statusCode).toBe(200);
    conforms("/claims/lint", "POST", lint);
    expect((lint.json() as { matches: unknown[] }).matches).toHaveLength(2);
    const disposition = await call(t.lead, "POST", "/claims/dispositions", {
      sentence: "Our SOC 2 reading list is public.",
      ruleId: "soc2",
      reason: "A reading list, not a claim",
    });
    expect(disposition.statusCode).toBe(201);
    conforms("/claims/dispositions", "POST", disposition);
  });

  it("GET and PUT /restricted-phrases", async () => {
    const got = await call(t.reader, "GET", "/restricted-phrases");
    expect(got.statusCode).toBe(200);
    conforms("/restricted-phrases", "GET", got);
    const put = await call(t.marketing, "PUT", "/restricted-phrases", {
      rules: DEFAULT_PHRASE_RULES,
      reviewerId: leadId,
      note: "No change, republish",
    });
    expect(put.statusCode).toBe(201);
    conforms("/restricted-phrases", "PUT", put);
  });

  it("documents the refusals: 400, 403, 404 and 409 are problem details", async () => {
    const forbidden = await call(t.reader, "POST", "/claims", { text: "We review sender feeds." });
    expect(forbidden.statusCode).toBe(403);
    conforms("/claims", "POST", forbidden);
    const bad = await call(t.drafter, "POST", "/claims", { text: "x" });
    expect(bad.statusCode).toBe(400);
    conforms("/claims", "POST", bad);
    const missing = await call(t.reader, "GET", "/claims/nope");
    expect(missing.statusCode).toBe(404);
    conforms("/claims/{id}", "GET", missing);
    const { id } = await draft();
    const noEvidence = await call(t.lead, "POST", `/claims/${id}/review`, {
      decision: "approve",
      note: "Checked it",
    });
    expect(noEvidence.statusCode).toBe(409);
    conforms("/claims/{id}/review", "POST", noEvidence);
  });
});
