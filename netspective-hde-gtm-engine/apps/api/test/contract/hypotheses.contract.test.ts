import type { LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

// Task T053: real responses are validated against specs/004-account-research-hypotheses/contracts/hypotheses.openapi.yaml.
const contract = new Contract("hypotheses.openapi.yaml", "004-account-research-hypotheses");
let fx: IdentityFixture;
let t: { analyst: string; reviewer: string; reader: string };
let n = 0;
async function setup() {
  fx = await buildIdentityFixture({ researchScenario: "northvale" });
  t = {
    analyst: (await fx.makeUser("analyst@example.org", ["research_analyst"])).token,
    reviewer: (await fx.makeUser("reviewer@example.org", ["technical_sme_reviewer"])).token,
    reader: (await fx.makeUser("reader@example.org", ["read_only_executive"])).token,
  };
  const now = new Date().toISOString();
  fx.db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('acc-n','Northvale HIE','northvale hie',?,?)",
    )
    .run(now, now);
  fx.db.raw
    .prepare(
      "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES ('c1','acc-n','health_information_exchange',?)",
    )
    .run(now);
  fx.db.raw
    .prepare(
      "INSERT INTO account_domain (id, account_id, domain, created_at) VALUES ('d1','acc-n','northvale-hie.example',?)",
    )
    .run(now);
}
afterEach(async () => {
  await fx.app.close();
});
const call = (token: string, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
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
const signal = (observation: string, over: Record<string, unknown> = {}) =>
  fx.signals.record({ userId: "analyst-1", actorType: "human", correlationId: null }, {
    accountId: "acc-n",
    typeKey: "onboarding_delay",
    observation,
    observedAt: new Date().toISOString(),
    source: {
      sourceId: "default-source-official_publication",
      ref: `https://example.org/${Math.random().toString(36).slice(2)}`,
    },
    ...over,
  } as never).signal;
const body = (signalIds: string[], over: Record<string, unknown> = {}) => ({
  statement: "Sender onboarding delays after implementation-guide changes may be slowing intake.",
  category: "onboarding_friction",
  relevance: { icp: ["icp1"] },
  supportingSignalIds: signalIds,
  assumptions: ["Senders use several formats."],
  confidence: { band: "medium", explanation: "Two public observations agree." },
  ...over,
});

describe("hypotheses contract", () => {
  it("creates, lists, reads, edits, links, annotates and reviews a hypothesis", async () => {
    await setup();
    const s1 = signal("Senders report onboarding delays.");
    const s2 = signal("An implementation guide changed.", {
      typeKey: "implementation_guide_change",
    });
    const created = await call(t.analyst, "POST", "/accounts/acc-n/hypotheses", body([s1.id]));
    expect(created.statusCode).toBe(201);
    conforms("/accounts/{id}/hypotheses", "post", created);
    const id = created.json().id as string;
    expect(created.json()).toMatchObject({ status: "untested", acceptance: "accepted" });

    const list = await call(t.reader, "GET", "/accounts/acc-n/hypotheses");
    conforms("/accounts/{id}/hypotheses", "get", list);
    expect(list.json().items).toHaveLength(1);
    expect(
      (await call(t.reader, "GET", "/accounts/acc-n/hypotheses?acceptance=proposed")).json().items,
    ).toEqual([]);
    const detail = await call(t.reader, "GET", `/hypotheses/${id}`);
    conforms("/hypotheses/{id}", "get", detail);

    const edited = await call(t.analyst, "PATCH", `/hypotheses/${id}`, {
      confidence: { band: "high", explanation: "More sources agree now." },
    });
    expect(edited.statusCode).toBe(200);
    conforms("/hypotheses/{id}", "patch", edited);
    const linked = await call(t.analyst, "POST", `/hypotheses/${id}/evidence`, {
      signalId: s2.id,
      role: "supporting",
    });
    expect(linked.statusCode).toBe(200);
    conforms("/hypotheses/{id}/evidence", "post", linked);
    expect(
      (
        await call(t.analyst, "POST", `/hypotheses/${id}/evidence`, {
          signalId: s2.id,
          role: "supporting",
        })
      ).statusCode,
    ).toBe(409);
    const assumed = await call(t.analyst, "POST", `/hypotheses/${id}/assumptions`, {
      text: "The pilot needs a small set of named fields.",
    });
    conforms("/hypotheses/{id}/assumptions", "post", assumed);

    const noNote = await call(t.reviewer, "PATCH", `/hypotheses/${id}`, {
      status: "strengthening",
    });
    expect(noNote.statusCode).toBe(422);
    conforms("/hypotheses/{id}", "patch", noNote);
    const reviewed = await call(t.reviewer, "PATCH", `/hypotheses/${id}`, {
      status: "strengthening",
      note: "Two sources agree on the delays.",
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().status).toBe("strengthening");
    expect(reviewed.json().statusHistory).toHaveLength(1);
    const notAllowed = await call(t.reviewer, "PATCH", `/hypotheses/${id}`, {
      status: "stale",
      note: "tried to set stale",
    });
    expect(notAllowed.statusCode).toBe(409);
    conforms("/hypotheses/{id}", "patch", notAllowed);
    const noEvidence = await call(t.reviewer, "PATCH", `/hypotheses/${id}`, {
      status: "validated",
      note: "many signals agree",
    });
    expect(noEvidence.statusCode).toBe(422);
    expect(noEvidence.json().detail).toContain("validated_needs_buyer_confirmed_evidence");
    const cats = await call(t.reader, "GET", "/hypothesis-categories");
    conforms("/hypothesis-categories", "get", cats);
    expect(cats.json().items.length).toBeGreaterThanOrEqual(7);
  });
  it("accepts and dismisses AI proposals from a research run", async () => {
    await setup();
    fx.db.raw
      .prepare(
        "INSERT INTO research_source_rule (id, kind, match_type, pattern, status, signal_source_kind, created_at) VALUES ('r1','public_org_site','host_suffix','northvale-hie.example','enabled','official_publication','2026-11-19')",
      )
      .run();
    const run = fx.research.research.startRun(
      { userId: "analyst-1", actorType: "human", correlationId: null },
      "acc-n",
      {
        sources: [
          { address: "https://news.northvale-hie.example/senders" },
          { address: "https://docs.northvale-hie.example/ig-update" },
        ],
      },
    );
    await fx.research.runner.execute(run.id);
    const proposals = await call(t.reader, "GET", "/accounts/acc-n/hypotheses?acceptance=proposed");
    conforms("/accounts/{id}/hypotheses", "get", proposals);
    expect(proposals.json().items).toHaveLength(1);
    const id = proposals.json().items[0].id as string;
    expect(proposals.json().items[0]).toMatchObject({
      label: "AI-proposed, not accepted",
      status: null,
    });
    const accepted = await call(t.analyst, "POST", `/hypotheses/${id}/accept`);
    expect(accepted.statusCode).toBe(200);
    conforms("/hypotheses/{id}/accept", "post", accepted);
    expect(accepted.json().status).toBe("untested");
    expect((await call(t.analyst, "POST", `/hypotheses/${id}/accept`)).statusCode).toBe(409);
    expect((await call(t.analyst, "POST", `/hypotheses/${id}/dismiss`)).statusCode).toBe(409);
  });
  it("answers problems for a refused statement, unknown ids and missing permissions", async () => {
    await setup();
    const s = signal("Senders report onboarding delays.");
    const refused = await call(
      t.analyst,
      "POST",
      "/accounts/acc-n/hypotheses",
      body([s.id], { statement: "The funding path is confirmed for this programme." }),
    );
    expect(refused.statusCode).toBe(422);
    expect(refused.json().detail).toContain("asserts_funding_path");
    conforms("/accounts/{id}/hypotheses", "post", refused);
    const invalid = await call(t.analyst, "POST", "/accounts/acc-n/hypotheses", {
      statement: "short",
    });
    expect(invalid.statusCode).toBe(400);
    conforms("/accounts/{id}/hypotheses", "post", invalid);
    expect(
      (await call(t.analyst, "POST", "/accounts/nope/hypotheses", body([s.id]))).statusCode,
    ).toBe(404);
    expect(
      (await call(t.reader, "POST", "/accounts/acc-n/hypotheses", body([s.id]))).statusCode,
    ).toBe(403);
    expect((await call(t.reader, "GET", "/hypotheses/nope")).statusCode).toBe(404);
    const created = await call(t.analyst, "POST", "/accounts/acc-n/hypotheses", body([s.id]));
    const id = created.json().id as string;
    expect(
      (
        await call(t.analyst, "PATCH", `/hypotheses/${id}`, {
          status: "strengthening",
          note: "an analyst tries",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(t.reviewer, "PATCH", `/hypotheses/${id}`, {
          statement: "A reviewer cannot edit the statement text.",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      Number(
        (
          fx.db.raw
            .prepare(
              "SELECT count(*) c FROM audit_event WHERE action IN ('hypotheses.review.denied','hypotheses.edit.denied')",
            )
            .get() as { c: number }
        ).c,
      ),
    ).toBe(3); // the reader's create, the analyst's status change and the reviewer's edit
  });
});
