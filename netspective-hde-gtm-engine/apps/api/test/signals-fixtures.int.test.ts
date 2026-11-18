import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// End to end over the synthetic fixtures (task T067): organisations are imported through the API, then
// every fixture signal is recorded through the API and the expected outcomes are asserted, including the
// conflicting lakeshore-hie evidence (SC-012).
const FIXTURES = join(import.meta.dirname, "../../../tests/fixtures/synthetic-orgs");
interface FixtureSignal {
  label: string;
  account: string;
  typeKey: string;
  source: { sourceId: string; ref: string; itemKey?: string };
  observation: string;
  excerpt?: string;
  excerptFiller?: number;
  observedAt: string;
  publishedAt?: string;
  fundingClass?: string;
  approvalCitation?: string;
  regulatoryItem?: string;
  regulatoryStatus?: string;
  expect?: Record<string, string>;
}
const fixture = JSON.parse(readFileSync(join(FIXTURES, "signals.json"), "utf8")) as {
  signals: FixtureSignal[];
};

let fx: IdentityFixture;
let operator: { token: string };
let reviewer: { token: string };
let n = 0;
const accountOf = (domain: string) =>
  (
    fx.db.raw.prepare("SELECT account_id id FROM account_domain WHERE domain = ?").get(domain) as {
      id: string;
    }
  ).id;
const post = (payload: object) =>
  fx.app.inject({
    method: "POST",
    url: "/api/v1/signals",
    headers: {
      authorization: `Bearer ${operator.token}`,
      "idempotency-key": `e2e-key-${++n}-padding`,
    },
    payload,
  });
const toBody = (s: FixtureSignal) => {
  const { account, excerptFiller, ...rest } = s;
  delete (rest as { label?: string }).label;
  delete (rest as { expect?: unknown }).expect;
  return {
    ...rest,
    accountId: accountOf(account),
    ...(excerptFiller
      ? {
          excerpt: "Synthetic filler text. "
            .repeat(Math.ceil(excerptFiller / 23))
            .slice(0, excerptFiller),
        }
      : {}),
  };
};
const decide = (id: string, body: object) =>
  fx.app.inject({
    method: "POST",
    url: `/api/v1/signals/${id}/review`,
    headers: {
      authorization: `Bearer ${reviewer.token}`,
      "idempotency-key": `e2e-key-${++n}-padding`,
    },
    payload: body,
  });

beforeEach(async () => {
  fx = await buildIdentityFixture();
  operator = await fx.makeUser("operator@example.org", ["gtm_operator"]);
  reviewer = await fx.makeUser("reviewer@example.org", ["technical_sme_reviewer"]);
  const imported = await fx.app.inject({
    method: "POST",
    url: "/api/v1/accounts/import",
    headers: {
      authorization: `Bearer ${operator.token}`,
      "content-type": "text/csv",
      "idempotency-key": "e2e-import-key-0001",
    },
    payload: readFileSync(join(FIXTURES, "organisations.csv"), "utf8"),
  });
  expect(imported.statusCode).toBe(201);
});
afterEach(async () => {
  await fx.app.close();
});

describe("fixture signals end to end", () => {
  it("records every fixture and meets each expected outcome", async () => {
    const ids = new Map<string, string>();
    for (const s of fixture.signals) {
      const res = await post(toBody(s));
      const e = s.expect ?? {};
      if (e["refused"]) {
        expect(res.statusCode, s.label).toBe(422);
        expect(res.json().detail, s.label).toContain(e["refused"]);
        continue;
      }
      expect([200, 201], `${s.label} ${res.body}`).toContain(res.statusCode);
      const body = res.json();
      ids.set(s.label, body.signal.id);
      if (e["outcome"]) expect(body.outcome, s.label).toBe(e["outcome"]);
      if (e["mergeKind"]) expect(body.mergeKind, s.label).toBe(e["mergeKind"]);
      if (e["fundingClass"]) expect(body.signal.fundingClass, s.label).toBe(e["fundingClass"]);
      if (e["regulatoryStatus"])
        expect(body.signal.regulatoryStatus, s.label).toBe(e["regulatoryStatus"]);
      if (e["excerptWithheld"]) {
        expect(body.signal.excerpt, s.label).toBeNull();
        expect(body.signal.excerptWithheldReason, s.label).toBe(e["excerptWithheld"]);
        expect(body.signal.source.ref, s.label).toBeTruthy();
      }
    }

    // One signal per category A to I, each under the taxonomy version it was recorded under.
    const rows = fx.db.raw
      .prepare(
        "SELECT DISTINCT st.category c FROM signal s JOIN signal_type st ON st.taxonomy_version = s.taxonomy_version AND st.key = s.type_key",
      )
      .all() as { c: string }[];
    expect(rows.map((r) => r.c).sort()).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
    expect(
      (
        fx.db.raw.prepare("SELECT count(*) c FROM signal WHERE taxonomy_version IS NULL").get() as {
          c: number;
        }
      ).c,
    ).toBe(0);

    // The RFP on two portals is one signal with two sources; identical and reworded copies add none.
    const rfp = ids.get("E-rfp-portal-a")!;
    expect(ids.get("E-rfp-portal-b")).toBe(rfp);
    expect(ids.get("B-ig-identical")).toBe(ids.get("B-ig-reworded"));
    expect(ids.get("B-ig-identical")).toBe(ids.get("B-ig-change"));
    const detail = (
      await fx.app.inject({
        method: "GET",
        url: `/api/v1/signals/${rfp}`,
        headers: { authorization: `Bearer ${reviewer.token}` },
      })
    ).json();
    expect(
      new Set(detail.provenance.map((p: { sourceId: string | null }) => p.sourceId)).size,
    ).toBe(2);

    // Regulatory signals are context-only with the re-verify flag; undated sources are flagged.
    const cms = (
      await fx.app.inject({
        method: "GET",
        url: `/api/v1/signals/${ids.get("H-cms")}`,
        headers: { authorization: `Bearer ${reviewer.token}` },
      })
    ).json();
    expect(cms.flags).toMatchObject({ contextOnly: true, reverifyRequired: true });
    expect(cms.externalUse).toBe("not_without_reverification");
    const hiring = (
      await fx.app.inject({
        method: "GET",
        url: `/api/v1/signals/${ids.get("F-hiring")}`,
        headers: { authorization: `Bearer ${reviewer.token}` },
      })
    ).json();
    expect(hiring.undated).toBe(true);

    // lakeshore-hie: two conflicting public signals of equal reliability are both kept and flagged,
    // neither is selected, and neither counts as current evidence until a person decides.
    const a = ids.get("lakeshore-conflict-a")!;
    const b = ids.get("lakeshore-conflict-b")!;
    expect(a).not.toBe(b);
    expect((await decide(a, { decision: "approve" })).statusCode).toBe(200);
    expect((await decide(b, { decision: "approve" })).statusCode).toBe(200);
    const timelineUrl = `/api/v1/accounts/${accountOf("lakeshore-hie.example")}/signals?currentOnly=true`;
    const asReviewer = { authorization: `Bearer ${reviewer.token}` };
    expect(
      (await fx.app.inject({ method: "GET", url: timelineUrl, headers: asReviewer }))
        .json()
        .items.map((i: { id: string }) => i.id)
        .sort(),
    ).toEqual([a, b].sort());
    const flagged = await decide(a, { decision: "contradict", contradictsSignalId: b });
    expect(flagged.statusCode).toBe(200);
    expect(flagged.json().reviewStatus).toBe("contradictory");
    const other = (
      await fx.app.inject({ method: "GET", url: `/api/v1/signals/${b}`, headers: asReviewer })
    ).json();
    expect(other.reviewStatus).toBe("contradictory");
    expect(other.reliability).toBe(flagged.json().reliability);
    expect(
      (await fx.app.inject({ method: "GET", url: timelineUrl, headers: asReviewer })).json().items,
    ).toEqual([]);
    const all = (
      await fx.app.inject({
        method: "GET",
        url: `/api/v1/accounts/${accountOf("lakeshore-hie.example")}/signals`,
        headers: asReviewer,
      })
    ).json().items;
    expect(all.filter((i: { id: string }) => i.id === a || i.id === b)).toHaveLength(2);
    // A person decides: one is kept, the other rejected with a reason.
    expect((await decide(a, { decision: "approve" })).statusCode).toBe(200);
    expect(
      (await decide(b, { decision: "reject", reason: "the later notice supersedes it" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await fx.app.inject({ method: "GET", url: timelineUrl, headers: asReviewer }))
        .json()
        .items.map((i: { id: string }) => i.id),
    ).toEqual([a]);

    // Funding never becomes a funding path; every change and refusal is audited without content.
    const dump =
      JSON.stringify(fx.db.raw.prepare("SELECT * FROM audit_event").all()) +
      JSON.stringify(fx.db.raw.prepare("SELECT payload FROM outbox_event").all());
    expect(dump).not.toContain("implementation guide");
    expect(dump).not.toContain("Synthetic filler");
    expect(dump).not.toMatch(/funding_?path/i);
    const actions = (
      fx.db.raw.prepare("SELECT DISTINCT action FROM audit_event").all() as { action: string }[]
    ).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "signal.record",
        "signal.merge",
        "signal.review.approve",
        "signal.review.contradict",
        "signal.review.reject",
        "signal.record.refused",
      ]),
    );
  });
});
