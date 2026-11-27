import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";
import { offer6Findings } from "../test-support/workshop-findings.js";
import { seedLinkedIntake } from "../test-support/workshop-seed.js";

// Feature 007: the boundary guard must hold what looks like patient data without refusing ordinary work:
// a field list that merely NAMES patient fields, and a large clean data file.
const NAMES = [
  "patient_id",
  "DOB",
  "encounter_date",
  "MRN",
  "visit type",
  "payer_id",
  "dx_code_1",
  "OBX-5",
  "admit_ts",
  "first_name",
];
let fx: IdentityFixture;
let token: string;
let lead: string;
let n = 0;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  token = (await fx.makeUser("operator@example.org", ["gtm_operator"])).token;
  lead = (await fx.makeUser("lead@example.org", ["sales_service_lead"])).token;
});
afterEach(async () => {
  await fx.app.close();
});
async function call(method: "GET" | "POST" | "PUT", url: string, payload?: unknown, by = token) {
  const res = await fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${by}`, "idempotency-key": `edge-key-${++n}-padding` },
    payload: payload as object | undefined,
  });
  expect(res.statusCode, `${method} ${url} ${res.body}`).toBeLessThan(300);
  return res;
}

async function held() {
  const seeded = seedLinkedIntake(fx.db, 6, NAMES);
  const { id } = (await call("POST", "/workshops", { requestId: seeded.requestId })).json();
  await call("POST", `/workshops/${id}/transition`, {
    action: "book",
    lockNo: 1,
    scheduledAt: "2026-12-01T10:00:00.000Z",
  });
  await call("POST", `/workshops/${id}/transition`, { action: "hold", lockNo: 2 });
  return id as string;
}

describe("a field list that names patient fields", () => {
  it("passes through findings, brief and the buyer page", async () => {
    const id = await held();
    const content = offer6Findings();
    content.fields.forEach((f, i) => {
      f.intakeName = NAMES[i]!;
      f.name = NAMES[i]!;
    });
    // The DOB field itself is unknown, so the page names it beside the session date.
    content.fields[1]!.observations.freshness.status = "unknown";
    content.fields[3]!.observations.access.status = "gap";
    content.overall.dependsOnUnknowns = [{ field: "DOB", dimension: "freshness" }];
    await call("POST", `/workshops/${id}/brief`);
    await call("PUT", `/workshops/${id}/findings`, { content });
    await call("POST", `/workshops/${id}/findings/finalise`, {});
    const draft = (await call("POST", `/workshops/${id}/output`)).json();
    expect(draft.sections.unknowns).toContain("DOB (freshness)");
    const { title, summary, nextStep, inScope, outOfScope } = draft.sections;
    await call("PUT", `/workshops/${id}/output`, {
      baseRevisionNo: 1,
      sections: { title, summary, nextStep, inScope, outOfScope },
    });
    await call("POST", `/workshops/${id}/output/approve`, undefined, lead);
    await call("GET", `/workshops/${id}`);
  });
});

describe("a large clean data file", () => {
  it("is received, not held", async () => {
    const id = await held();
    const rows = Array.from({ length: 11000 }, (_, i) => ({
      rule: `segment-rule-${i}`,
      outcome: "rejected because a unit code was missing",
    }));
    const content = JSON.stringify(rows);
    expect(content.length).toBeGreaterThan(400_000);
    expect(content.length).toBeLessThan(1_048_576);
    const res = await call("POST", `/workshops/${id}/artifacts`, {
      kind: "scrubbed_rejection_log",
      title: "Large log",
      content,
      fileName: "large.json",
    });
    expect(res.json()).toMatchObject({ state: "received", holdRuleIds: [] });
  });
});
