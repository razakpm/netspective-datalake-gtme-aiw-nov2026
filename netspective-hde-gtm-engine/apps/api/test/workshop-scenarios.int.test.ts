import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";
import { offer1Findings, offer6Findings } from "../test-support/workshop-findings.js";
import { FIELD_NAMES } from "../test-support/workshops-harness.js";

// Feature 007 task T068 (quickstart V32): Scenarios A, B and D end to end over the synthetic organisations,
// through the real routes: organisations imported, the public intake form, the request inbox, and the
// workshop from booking to an approved page. No message is sent and no qualification decision is recorded.
const FIXTURES = join(import.meta.dirname, "../../../tests/fixtures/synthetic-orgs");
const O1 = "sender-onboarding-friction-map";
const O6 = "pilot-input-trace-workshop";

let fx: IdentityFixture;
let t: { operator: string; lead: string };
let n = 0;
const timings: { what: string; ms: number }[] = [];

beforeEach(async () => {
  timings.length = 0;
  fx = await buildIdentityFixture();
  t = {
    operator: (await fx.makeUser("operator@example.org", ["gtm_operator"])).token,
    lead: (await fx.makeUser("lead@example.org", ["sales_service_lead"])).token,
  };
  const imported = await fx.app.inject({
    method: "POST",
    url: "/api/v1/accounts/import",
    headers: {
      authorization: `Bearer ${t.operator}`,
      "content-type": "text/csv",
      "idempotency-key": `scenario-import-${++n}-padding`,
    },
    payload: readFileSync(join(FIXTURES, "organisations.csv"), "utf8"),
  });
  expect(imported.statusCode).toBeLessThan(300);
  const who = (id: string) => ({
    userId: id,
    actorType: "human" as const,
    correlationId: null,
    permissions: FOUNDATION_ROLE_PERMISSIONS.campaign_approver,
    now: () => fx.clock.now,
  });
  const notice = fx.engagement.notices.create(who("author"), {
    noticeText: "We use your details to prepare the session and nothing else.",
    consentText: "I agree to be contacted.",
  });
  fx.engagement.notices.approve(who("approver"), notice.id);
});
afterEach(async () => {
  await fx.app.close();
});

async function call(
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  token = t.operator,
  expected?: number,
) {
  const started = performance.now();
  const res = await fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `scenario-key-${++n}-padding` },
    payload: payload as object | undefined,
  });
  timings.push({ what: `${method} ${url}`, ms: performance.now() - started });
  if (expected !== undefined) expect(res.statusCode, `${url} ${res.body}`).toBe(expected);
  else expect(res.statusCode, `${url} ${res.body}`).toBeLessThan(300);
  return res;
}

/** The buyer's public intake, then the operator's link in the inbox, then the conversion. */
async function workshopFor(slug: string, domain: string, orgName: string, intake: unknown) {
  const form = (
    await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${slug}/form` })
  ).json();
  fx.clock.now = new Date(fx.clock.now.getTime() + 5000);
  const submitted = await fx.app.inject({
    method: "POST",
    url: `/api/v1/public/offers/${slug}/requests`,
    payload: {
      kind: "intake",
      formToken: form.formToken,
      noticeVersionId: form.notice.versionId,
      consentToContact: true,
      website: "",
      contact: {
        email: `integration.lead@${domain}`,
        role: "Integration Lead",
        orgName,
        orgType: slug === O1 ? "health_information_exchange" : "health_system",
      },
      intake,
    },
  });
  expect(submitted.statusCode, submitted.body).toBe(201);
  const requestId = submitted.json().requestId as string;
  await call("POST", `/offer-requests/${requestId}/review`, { action: "link" });
  return (await call("POST", "/workshops", { requestId })).json() as {
    id: string;
    accountId: string;
  };
}
const move = async (id: string, action: string, over: Record<string, unknown> = {}) => {
  const { lockNo } = (await call("GET", `/workshops/${id}`)).json();
  return (await call("POST", `/workshops/${id}/transition`, { action, lockNo, ...over })).json();
};
const soon = () => new Date(fx.clock.now.getTime() + 3 * 86_400_000).toISOString();

async function finaliseAndApprove(id: string, content: unknown) {
  await call("PUT", `/workshops/${id}/findings`, { content });
  await call("POST", `/workshops/${id}/findings/finalise`, {});
  await call("POST", `/workshops/${id}/output`);
  return (await call("POST", `/workshops/${id}/output/approve`, undefined, t.lead)).json();
}

/** Nothing in the store records qualification, an economic buyer or a funding path for a workshop. */
function expectNoQualification() {
  const tables = (
    fx.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  expect(tables.filter((name) => /qualif|opportunit|funding|buyer/i.test(name))).toEqual([]);
  const findings = JSON.stringify(
    fx.db.raw.prepare("SELECT content_json FROM workshop_finding").all(),
  );
  expect(findings).not.toMatch(/economicBuyer|fundingPath|budget|qualified/i);
}

describe("Scenario A: Offer 1 for northvale-hie", () => {
  it("runs from the intake to an approved page with the delay and owner confirmed", async () => {
    const w = await workshopFor(O1, "northvale-hie.example", "Northvale HIE", {
      programType: "health_information_exchange",
      organisationName: "Northvale HIE",
      recentOnboarding: {
        senderLabel: "Synthetic sender A",
        formatAndGuide: "HL7 v2 results with the exchange implementation guide",
        timelineAndStages: "Registration, testing, rejection review, production",
      },
      attendingRoles: ["Integration lead"],
      specsAvailable: "yes",
      scrubbedRejectionLogsAvailable: "yes",
    });
    await call("POST", `/workshops/${w.id}/brief`);
    await move(w.id, "book", { scheduledAt: soon() });
    await move(w.id, "hold");
    const findings = offer1Findings();
    findings.delaySources[0]!.confirmation = "confirmed";
    const page = await finaliseAndApprove(w.id, findings);
    expect(page).toMatchObject({ state: "approved", pdfPages: 1 });
    expect(page.sections.findings).toContain("(confirmed by the buyer)");
    expect(page.sections.findings).toContain("(confirmation unknown)");
    await call("POST", `/workshops/${w.id}/output/share`, { how: "handed_over" });

    const done = (await call("GET", `/workshops/${w.id}`)).json();
    expect(done.state).toBe("findings_recorded");
    const saved = (await call("GET", `/workshops/${w.id}/findings`)).json().current.content;
    expect(saved.delaySources.map((s: { ownerClass: string }) => s.ownerClass)).toEqual([
      "operator",
      "sender",
      "rule_owner",
    ]);
    expect(saved.delaySources[0].confirmedBy).toBeTruthy();
    expectNoQualification();
    expect(
      fx.db.raw
        .prepare("SELECT type FROM outbox_event WHERE type LIKE 'workshop.%' ORDER BY rowid")
        .all()
        .map((r) => (r as { type: string }).type),
    ).toEqual([
      "workshop.requested",
      "workshop.booked",
      "workshop.held",
      "workshop.findings_recorded",
    ]);
    const events = JSON.stringify(fx.db.raw.prepare("SELECT payload FROM outbox_event").all());
    expect(events).not.toMatch(/Northvale|manual review|integration\.lead/i);

    // Plan goals, measured in memory with the fake providers.
    for (const { what, ms } of timings) {
      if (what.endsWith("/output/approve")) expect(ms, what).toBeLessThan(5000);
      else if (what.endsWith("/brief")) expect(ms, what).toBeLessThan(1000);
      else if (/\/workshops/.test(what)) expect(ms, what).toBeLessThan(300);
    }
  });
});

describe("Scenario B: Offer 6 for riverbend-health", () => {
  it("traces the ten fields to a conditional view and a draft scope", async () => {
    const w = await workshopFor(O6, "riverbend-health.example", "Riverbend Health", {
      useCase: "Readmission risk pilot",
      pilotOwner: "Clinical informatics lead",
      sourceSystems: ["Synthetic clinical system", "Synthetic laboratory system"],
      fieldNames: FIELD_NAMES,
      dataLead: "Integration lead",
      attendees: ["Integration lead", "Pilot owner"],
    });
    await move(w.id, "book", { scheduledAt: soon() });
    await move(w.id, "hold");
    const findings = offer6Findings();
    findings.fields[2]!.observations.provenance.status = "unknown";
    findings.overall.dependsOnUnknowns = [{ field: FIELD_NAMES[2]!, dimension: "provenance" }];
    const page = await finaliseAndApprove(w.id, findings);
    expect(page.sections.findings).toContain("Overall view: conditional");
    expect(page.sections.unknowns).toContain(`${FIELD_NAMES[2]} (provenance)`);
    expect(page.sections.unknowns).not.toMatch(/gap|fail/i);
    expect(page.sections.disclaimer).toContain("not a guarantee");
    expect(page.sections.nextStep).toContain("Input Audit");
    const view = (await call("GET", `/workshops/${w.id}/findings`)).json();
    expect(view.current.content.fields).toHaveLength(10);
    expect(view.current.content.inputAuditScope.sources).toHaveLength(1);
    expect(view.summary).toMatchObject({ unknown: 1, notRecorded: 0 });
    expectNoQualification();
  });
});

describe("Scenario D: granite-health", () => {
  it("holds the apparent PHI artifact; nothing reaches a model or a log", async () => {
    // Its imported row carries patient-like text and was refused (feature 002), so the account is the one
    // the intake form creates.
    const w = await workshopFor(O6, "granite-health.example", "Granite Health", {
      useCase: "Readmission risk pilot",
      pilotOwner: "Pilot owner",
      sourceSystems: ["Synthetic clinical system"],
      fieldNames: FIELD_NAMES,
      dataLead: "Integration lead",
      attendees: ["Integration lead"],
    });
    const samples = [
      "Patient: Jordan Testcase, MRN: 00123456, admitted for observation.",
      "Name: Avery Exampleton  DOB: 03/14/1971",
      "Applicant SSN 000-12-3456 was submitted with the request.",
      "patient_name,mrn,dob,diagnosis\nJordan Testcase,00123456,1971-03-14,E11.9\nAvery Exampleton,00123457,1980-07-02,I10\n",
    ];
    for (const [i, content] of samples.entries()) {
      const res = await call(
        "POST",
        `/workshops/${w.id}/artifacts`,
        { kind: "scrubbed_rejection_log", title: `Upload ${i + 1}`, content },
        t.operator,
        202,
      );
      expect(res.json().state).toBe("held");
    }
    await call("POST", `/workshops/${w.id}/brief`);
    const secrets = /Testcase|Exampleton|000-12-3456|00123456/;
    expect(fx.logs.join("\n")).not.toMatch(secrets);
    expect(JSON.stringify(fx.fakeLlm.calls)).not.toMatch(secrets);
    for (const table of [
      "workshop_artifact",
      "workshop_brief",
      "audit_event",
      "outbox_event",
      "phi_guard_decision",
      "ai_invocation",
      "idempotency_record",
    ]) {
      expect(JSON.stringify(fx.db.raw.prepare(`SELECT * FROM ${table}`).all()), table).not.toMatch(
        /Testcase|Exampleton|00123456/,
      );
    }
    expect(
      fx.db.raw
        .prepare("SELECT count(*) c FROM outbox_event WHERE type = 'operator.alert.phi'")
        .get(),
    ).toMatchObject({ c: 1 });
    expect(
      fx.db.raw.prepare("SELECT count(*) c FROM quarantine_item WHERE status = 'held'").get(),
    ).toMatchObject({ c: 4 });
    expect(fx.files.keys().filter((k) => k.startsWith("workshop-"))).toEqual([]);
  });
});
