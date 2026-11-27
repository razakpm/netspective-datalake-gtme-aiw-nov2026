import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";
import { seedLinkedIntake } from "../../test-support/workshop-seed.js";
import { offer1Findings, offer6Findings } from "../../test-support/workshop-findings.js";

// Feature 007: real responses are validated against
// specs/007-workshop-operations/contracts/workshops.openapi.yaml.
const contract = new Contract("workshops.openapi.yaml", "007-workshop-operations");
let fx: IdentityFixture;
let t: { operator: string; lead: string; reader: string };
let n = 0;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  t = {
    operator: (await fx.makeUser("operator@example.org", ["gtm_operator"])).token,
    lead: (await fx.makeUser("lead@example.org", ["sales_service_lead"])).token,
    reader: (await fx.makeUser("reader@example.org", ["read_only_executive"])).token,
  };
});
afterEach(async () => {
  await fx.app.close();
});
type Method = "GET" | "POST" | "PUT" | "DELETE";
const call = (token: string, method: Method, url: string, payload?: unknown) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `workshop-key-${++n}-padding` },
    payload: payload as object | undefined,
  });
const conforms = (path: string, method: string, res: LightMyRequestResponse) =>
  expect(
    contract.check(path, method, res.statusCode, String(res.headers["content-type"]), res.json()),
  ).toEqual([]);
const AT = () => new Date(fx.clock.now.getTime() + 5 * 86_400_000).toISOString();

async function convert(offer: 1 | 6 = 1, fieldNames?: string[]) {
  const seeded = seedLinkedIntake(fx.db, offer, fieldNames);
  const res = await call(t.operator, "POST", "/workshops", { requestId: seeded.requestId });
  expect(res.statusCode, res.body).toBe(201);
  conforms("/workshops", "post", res);
  return res.json() as { id: string; lockNo: number };
}

describe("workshops and the lifecycle", () => {
  it("converts, lists, reads and moves a workshop", async () => {
    const made = await convert();
    const list = await call(t.reader, "GET", "/workshops?state=requested");
    expect(list.statusCode).toBe(200);
    conforms("/workshops", "get", list);
    expect(list.json().items).toHaveLength(1);
    const booked = await call(t.operator, "POST", `/workshops/${made.id}/transition`, {
      action: "book",
      lockNo: 1,
      scheduledAt: AT(),
      via: "calendar",
    });
    expect(booked.statusCode, booked.body).toBe(200);
    conforms("/workshops/{id}/transition", "post", booked);
    const read = await call(t.reader, "GET", `/workshops/${made.id}`);
    expect(read.statusCode).toBe(200);
    conforms("/workshops/{id}", "get", read);
  });

  it("takes an intake whose field names look like patient fields", async () => {
    const made = await convert(6, [
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
    ]);
    const booked = await call(t.operator, "POST", `/workshops/${made.id}/transition`, {
      action: "book",
      lockNo: 1,
      scheduledAt: AT(),
    });
    expect(booked.statusCode, booked.body).toBe(200);
  });

  it("answers a replayed move with the stored result and moves nothing twice", async () => {
    const made = await convert();
    const send = () =>
      fx.app.inject({
        method: "POST",
        url: `/api/v1/workshops/${made.id}/transition`,
        headers: { authorization: `Bearer ${t.operator}`, "idempotency-key": "replayed-key-0001" },
        payload: { action: "book", lockNo: 1, scheduledAt: "2026-12-01T10:00:00.000Z" },
      });
    const first = await send();
    const second = await send();
    expect(second.json()).toEqual(first.json());
    expect(fx.db.raw.prepare("SELECT count(*) c FROM offer_session_booking").get()).toMatchObject({
      c: 1,
    });
  });

  it("documents the refusals", async () => {
    const made = await convert();
    const seeded = seedLinkedIntake(fx.db);
    await call(t.operator, "POST", "/workshops", { requestId: seeded.requestId });
    const again = await call(t.operator, "POST", "/workshops", { requestId: seeded.requestId });
    expect(again.statusCode).toBe(409);
    conforms("/workshops", "post", again);
    const bad = await call(t.operator, "POST", "/workshops", {});
    expect(bad.statusCode).toBe(400);
    conforms("/workshops", "post", bad);
    const forbidden = await call(t.reader, "POST", `/workshops/${made.id}/transition`, {
      action: "cancel",
      lockNo: 1,
      note: "not mine",
    });
    expect(forbidden.statusCode).toBe(403);
    conforms("/workshops/{id}/transition", "post", forbidden);
    const missing = await call(t.reader, "GET", "/workshops/missing");
    expect(missing.statusCode).toBe(404);
    conforms("/workshops/{id}", "get", missing);
    fx.calendar.failWith("provider_unavailable");
    const down = await call(t.operator, "POST", `/workshops/${made.id}/transition`, {
      action: "book",
      lockNo: 1,
      scheduledAt: AT(),
      via: "calendar",
    });
    expect(down.statusCode).toBe(502);
    expect(down.json().codes).toEqual(["calendar_failed"]);
    conforms("/workshops/{id}/transition", "post", down);
  });
});

describe("capacity", () => {
  it("documents the refusal when the offer is full", async () => {
    const made = await convert(6);
    await call(t.lead, "PUT", "/offers/offer-6/capacity", {
      periodKind: "month",
      limitSessions: 0,
      reason: "Pause bookings",
    });
    const full = await call(t.operator, "POST", `/workshops/${made.id}/transition`, {
      action: "book",
      lockNo: 1,
      scheduledAt: AT(),
    });
    expect(full.statusCode).toBe(409);
    expect(full.json().codes).toEqual(["capacity_exhausted"]);
    conforms("/workshops/{id}/transition", "post", full);
  });
});

describe("artifacts", () => {
  const PHI = "Patient: Jordan Testcase, MRN: 00123456, admitted for observation.";
  const upload = (id: string, over: Record<string, unknown> = {}) =>
    call(t.operator, "POST", `/workshops/${id}/artifacts`, {
      kind: "scrubbed_rejection_log",
      title: "Rejection log",
      content: "2026-11-02 rejected: unit code missing",
      fileName: "rejections.log",
      ...over,
    });

  it("records, lists and reads an artifact", async () => {
    const made = await convert();
    const recorded = await upload(made.id);
    expect(recorded.statusCode, recorded.body).toBe(201);
    conforms("/workshops/{id}/artifacts", "post", recorded);
    const list = await call(t.reader, "GET", `/workshops/${made.id}/artifacts`);
    expect(list.statusCode).toBe(200);
    conforms("/workshops/{id}/artifacts", "get", list);
    const id = (recorded.json() as { id: string }).id;
    const content = await call(t.reader, "GET", `/workshop-artifacts/${id}/content`);
    expect(content.statusCode).toBe(200);
    expect(content.body).toBe("2026-11-02 rejected: unit code missing");
    expect(content.headers).toMatchObject({
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
  });

  it("holds a flagged file with 202, keeps it out of the logs and lets a reviewer decide", async () => {
    const made = await convert();
    const held = await upload(made.id, { content: PHI });
    expect(held.statusCode, held.body).toBe(202);
    conforms("/workshops/{id}/artifacts", "post", held);
    expect(held.body).not.toContain("Testcase");
    expect(fx.logs.join("\n")).not.toContain("Testcase");
    const id = (held.json() as { id: string }).id;
    const blocked = await call(t.reader, "GET", `/workshop-artifacts/${id}/content`);
    expect(blocked.statusCode).toBe(409);
    conforms("/workshop-artifacts/{artifactId}/content", "get", blocked);
    const body = { decision: "discard", reason: "Contains patient data" };
    const forbidden = await call(t.operator, "POST", `/workshop-artifacts/${id}/decision`, body);
    expect(forbidden.statusCode).toBe(403);
    conforms("/workshop-artifacts/{artifactId}/decision", "post", forbidden);
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const decided = await call(admin.token, "POST", `/workshop-artifacts/${id}/decision`, body);
    expect(decided.statusCode, decided.body).toBe(200);
    conforms("/workshop-artifacts/{artifactId}/decision", "post", decided);
  });

  it("documents the refusals, including a body over the limit", async () => {
    const made = await convert();
    const binary = await upload(made.id, { fileName: "scan.pdf" });
    expect(binary.statusCode).toBe(422);
    conforms("/workshops/{id}/artifacts", "post", binary);
    const title = await upload(made.id, { title: PHI });
    expect(title.statusCode).toBe(422);
    conforms("/workshops/{id}/artifacts", "post", title);
    const large = await upload(made.id, { content: "x".repeat(1_048_577) });
    expect(large.statusCode).toBe(413);
    conforms("/workshops/{id}/artifacts", "post", large);
    const huge = await upload(made.id, { content: "x".repeat(3_000_000) });
    expect(huge.statusCode).toBe(413);
    expect(fx.logs.join("\n")).not.toContain("Testcase");
  });
});

async function held(offer: 1 | 6 = 1) {
  const made = await convert(offer);
  await call(t.operator, "POST", `/workshops/${made.id}/transition`, {
    action: "book",
    lockNo: 1,
    scheduledAt: AT(),
  });
  const res = await call(t.operator, "POST", `/workshops/${made.id}/transition`, {
    action: "hold",
    lockNo: 2,
  });
  return res.json() as { id: string; accountId: string };
}

describe("findings", () => {
  it.each([
    [1, offer1Findings],
    [6, offer6Findings],
  ] as const)("reads, saves and finalises Offer %s findings", async (offer, content) => {
    const w = await held(offer);
    const empty = await call(t.reader, "GET", `/workshops/${w.id}/findings`);
    expect(empty.statusCode).toBe(200);
    conforms("/workshops/{id}/findings", "get", empty);
    const saved = await call(t.operator, "PUT", `/workshops/${w.id}/findings`, {
      content: content(),
    });
    expect(saved.statusCode, saved.body).toBe(200);
    conforms("/workshops/{id}/findings", "put", saved);
    const done = await call(t.operator, "POST", `/workshops/${w.id}/findings/finalise`, {});
    expect(done.statusCode, done.body).toBe(200);
    conforms("/workshops/{id}/findings/finalise", "post", done);
    const view = await call(t.reader, "GET", `/workshops/${w.id}/findings`);
    conforms("/workshops/{id}/findings", "get", view);
  });

  it("documents the refusals", async () => {
    const w = await held();
    const price = offer1Findings();
    price.flowSummary = "A fix costs $900";
    const refused = await call(t.operator, "PUT", `/workshops/${w.id}/findings`, {
      content: price,
    });
    expect(refused.statusCode).toBe(422);
    conforms("/workshops/{id}/findings", "put", refused);
    const incomplete = offer1Findings();
    incomplete.delaySources = [];
    await call(t.operator, "PUT", `/workshops/${w.id}/findings`, { content: incomplete });
    const short = await call(t.operator, "POST", `/workshops/${w.id}/findings/finalise`, {});
    expect(short.statusCode).toBe(422);
    expect(short.json().codes).toContain("findings_incomplete");
    conforms("/workshops/{id}/findings/finalise", "post", short);
  });

  it("suggests from notes without keeping the suggestion", async () => {
    const w = await held();
    fx.workshopRules.push({
      task: "synthesis",
      whenTextIncludes: [w.id],
      respond: {
        entityIds: { workshopId: w.id, accountId: w.accountId },
        items: [
          {
            path: "flowSummary",
            value: "Senders register and then test",
            interpretation: false,
            supportingText: "senders register and then test",
          },
        ],
        confidence: "low",
        rationale: "From the notes.",
        reviewStatus: "unreviewed",
      },
      repeat: true,
    });
    const res = await call(t.operator, "POST", `/workshops/${w.id}/findings/suggest`, {
      notes: "In the session: senders register and then test their feed.",
    });
    expect(res.statusCode, res.body).toBe(200);
    conforms("/workshops/{id}/findings/suggest", "post", res);
    expect(res.json().items).toHaveLength(1);
    expect(
      fx.db.raw
        .prepare("SELECT count(*) c FROM idempotency_record WHERE route LIKE '%suggest%'")
        .get(),
    ).toMatchObject({ c: 0 });
    fx.workshopRules.length = 0;
    const down = await call(t.operator, "POST", `/workshops/${w.id}/findings/suggest`, {
      notes: "In the session: senders register and then test their feed.",
    });
    expect(down.statusCode).toBe(503);
    conforms("/workshops/{id}/findings/suggest", "post", down);
  });
});

describe("the preparation brief", () => {
  it("generates, reads and marks a brief reviewed", async () => {
    const made = await convert();
    const empty = await call(t.reader, "GET", `/workshops/${made.id}/brief`);
    expect(empty.statusCode).toBe(200);
    conforms("/workshops/{id}/brief", "get", empty);
    const generated = await call(t.operator, "POST", `/workshops/${made.id}/brief`);
    expect(generated.statusCode, generated.body).toBe(201);
    conforms("/workshops/{id}/brief", "post", generated);
    const url = `/workshops/${made.id}/brief/${(generated.json() as { id: string }).id}/review`;
    const reviewed = await call(t.operator, "POST", url);
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    conforms("/workshops/{id}/brief/{briefId}/review", "post", reviewed);
    const twice = await call(t.operator, "POST", url);
    expect(twice.statusCode).toBe(409);
    conforms("/workshops/{id}/brief/{briefId}/review", "post", twice);
    const read = await call(t.reader, "GET", `/workshops/${made.id}/brief`);
    conforms("/workshops/{id}/brief", "get", read);
  });
});

describe("the buyer output", () => {
  it("generates, edits, approves, downloads and records sharing", async () => {
    const w = await held();
    await call(t.operator, "PUT", `/workshops/${w.id}/findings`, { content: offer1Findings() });
    const early = await call(t.operator, "POST", `/workshops/${w.id}/output`);
    expect(early.statusCode).toBe(409);
    conforms("/workshops/{id}/output", "post", early);
    await call(t.operator, "POST", `/workshops/${w.id}/findings/finalise`, {});
    const draft = await call(t.operator, "POST", `/workshops/${w.id}/output`);
    expect(draft.statusCode, draft.body).toBe(201);
    conforms("/workshops/{id}/output", "post", draft);
    const { title, summary, nextStep, inScope, outOfScope } = draft.json().sections;
    const edited = await call(t.operator, "PUT", `/workshops/${w.id}/output`, {
      baseRevisionNo: 1,
      sections: { title, summary, nextStep, inScope, outOfScope },
    });
    expect(edited.statusCode, edited.body).toBe(201);
    conforms("/workshops/{id}/output", "put", edited);
    const noPdf = await call(t.reader, "GET", `/workshops/${w.id}/output/pdf`);
    expect(noPdf.statusCode).toBe(409);
    conforms("/workshops/{id}/output/pdf", "get", noPdf);
    const forbidden = await call(t.operator, "POST", `/workshops/${w.id}/output/approve`);
    expect(forbidden.statusCode).toBe(403);
    conforms("/workshops/{id}/output/approve", "post", forbidden);
    const approved = await call(t.lead, "POST", `/workshops/${w.id}/output/approve`);
    expect(approved.statusCode, approved.body).toBe(200);
    conforms("/workshops/{id}/output/approve", "post", approved);
    const pdf = await call(t.reader, "GET", `/workshops/${w.id}/output/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers).toMatchObject({
      "content-type": "application/pdf",
      "cache-control": "no-store",
    });
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const shared = await call(t.operator, "POST", `/workshops/${w.id}/output/share`, {
      how: "handed_over",
    });
    expect(shared.statusCode, shared.body).toBe(201);
    conforms("/workshops/{id}/output/share", "post", shared);
    const read = await call(t.reader, "GET", `/workshops/${w.id}/output`);
    expect(read.statusCode).toBe(200);
    conforms("/workshops/{id}/output", "get", read);
  });
});

describe("delivery effort", () => {
  it("records effort and reads it and the summary", async () => {
    const made = await convert();
    const recorded = await call(t.operator, "POST", `/workshops/${made.id}/effort`, {
      prepHours: 2.5,
      sessionHours: 0.75,
      people: 2,
    });
    expect(recorded.statusCode, recorded.body).toBe(201);
    conforms("/workshops/{id}/effort", "post", recorded);
    const read = await call(t.reader, "GET", `/workshops/${made.id}/effort`);
    expect(read.statusCode).toBe(200);
    conforms("/workshops/{id}/effort", "get", read);
    const bad = await call(t.operator, "POST", `/workshops/${made.id}/effort`, {
      prepHours: 200,
      sessionHours: 1,
      people: 1,
    });
    expect(bad.statusCode).toBe(400);
    conforms("/workshops/{id}/effort", "post", bad);
    const summary = await call(t.reader, "GET", "/workshop-effort-summary");
    expect(summary.statusCode).toBe(200);
    conforms("/workshop-effort-summary", "get", summary);
  });
});

describe("participants", () => {
  it("adds and removes a participant", async () => {
    const made = await convert();
    const added = await call(t.operator, "POST", `/workshops/${made.id}/participants`, {
      side: "buyer",
      displayName: "Integration Lead",
    });
    expect(added.statusCode).toBe(201);
    conforms("/workshops/{id}/participants", "post", added);
    const url = `/workshops/${made.id}/participants/${(added.json() as { id: string }).id}`;
    const removed = await call(t.operator, "DELETE", url);
    expect(removed.statusCode).toBe(200);
    conforms("/workshops/{id}/participants/{participantId}", "delete", removed);
    const twice = await call(t.operator, "DELETE", url);
    expect(twice.statusCode).toBe(409);
    conforms("/workshops/{id}/participants/{participantId}", "delete", twice);
    const refused = await call(t.operator, "POST", `/workshops/${made.id}/participants`, {
      side: "buyer",
      displayName: "lead@buyer.example",
    });
    expect(refused.statusCode).toBe(422);
    conforms("/workshops/{id}/participants", "post", refused);
  });
});

describe("the contract", () => {
  it("has every operation exercised above", () => {
    const text = readFileSync(
      join(
        import.meta.dirname,
        "../../../../specs/007-workshop-operations/contracts/workshops.openapi.yaml",
      ),
      "utf8",
    );
    const doc = parse(text) as { paths: Record<string, Record<string, unknown>> };
    const documented = Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((m) => ["get", "put", "post", "delete"].includes(m))
        .map((m) => `${m} ${path}`),
    );
    const source = readFileSync(join(import.meta.dirname, "workshops.contract.test.ts"), "utf8");
    // Each operation is checked against its response schema, or (a file download) by its headers.
    const exercised = [...source.matchAll(/conforms\(\s*"([^"]+)",\s*"(\w+)"/g)].map(
      (m) => `${m[2]!.toLowerCase()} ${m[1]!}`,
    );
    const downloads = ["get /workshop-artifacts/{artifactId}/content"];
    expect(documented.filter((op) => !exercised.includes(op) && !downloads.includes(op))).toEqual(
      [],
    );
    expect(documented).toHaveLength(26);
  });
});
