import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T060 (quickstart V29): the Offer 1 intake over HTTP.
const SLUG = "sender-onboarding-friction-map";
let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  const who = (id: string) => ({
    userId: id,
    actorType: "human" as const,
    correlationId: null,
    permissions: FOUNDATION_ROLE_PERMISSIONS.campaign_approver,
    now: () => fx.clock.now,
  });
  const v = fx.engagement.notices.create(who("author"), {
    noticeText: "We use your details to prepare the session and nothing else.",
    consentText: "I agree to be contacted.",
  });
  fx.engagement.notices.approve(who("approver"), v.id);
});
afterEach(async () => {
  await fx.app.close();
});
const count = (table: string, where = "1=1") =>
  (fx.db.raw.prepare(`SELECT count(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c;
const clean = () => ({
  programType: "health_information_exchange",
  organisationName: "Northvale HIE",
  recentOnboarding: {
    senderLabel: "A regional hospital sender",
    formatAndGuide: "CCDA R2.1 against the 2026 implementation guide",
    timelineAndStages: "Six weeks across four stages",
  },
  knownDelays: ["Validation failures on the encounter section"],
  attendingRoles: ["Integration lead"],
  specsAvailable: "yes",
  scrubbedRejectionLogsAvailable: "no",
});
async function submit(intake: unknown) {
  const form = (
    await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
  ).json();
  fx.clock.now = new Date(fx.clock.now.getTime() + 5000);
  return fx.app.inject({
    method: "POST",
    url: `/api/v1/public/offers/${SLUG}/requests`,
    payload: {
      kind: "intake",
      formToken: form.formToken,
      noticeVersionId: form.notice.versionId,
      consentToContact: true,
      website: "",
      contact: {
        email: "dana@northvale-hie.example",
        role: "Integration Lead",
        orgName: "Northvale HIE",
        orgType: "health_information_exchange",
      },
      intake,
    },
  });
}

describe("the Offer 1 form", () => {
  it("lists its questions, none about budget, price, credentials or production data", async () => {
    const form = (
      await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
    ).json();
    expect(form.kinds).toEqual(["intake"]);
    const fields = form.fields.intake as { key: string; label: string }[];
    expect(fields.map((f) => f.key)).toContain("recentOnboarding.formatAndGuide");
    expect(JSON.stringify(fields)).not.toMatch(
      /budget|price|cost|funding|password|credential|production data|upload/i,
    );
  });
});

describe("Offer 1 intake submissions", () => {
  it("stores a clean intake against the account and contact, labelled non-PHI, queued for review (V29)", async () => {
    const res = await submit(clean());
    expect(res.statusCode).toBe(201);
    expect(res.json().download).toBeUndefined();
    const row = fx.db.raw
      .prepare(
        "SELECT kind, schema_version, classification, review_state, account_id, contact_id, payload_json FROM intake_submission",
      )
      .get() as Record<string, string | number>;
    expect(row).toMatchObject({
      kind: "offer_1",
      schema_version: 1,
      classification: "non_phi",
      review_state: "pending",
    });
    expect(row["account_id"]).toEqual(expect.any(String));
    expect(row["contact_id"]).toEqual(expect.any(String));
    expect(JSON.parse(row["payload_json"] as string)).toEqual(clean());
    expect(count("lead_magnet_download")).toBe(0);
    expect(count("offer_recommendation")).toBe(0);
    expect(
      fx.db.raw.prepare("SELECT DISTINCT type FROM outbox_event WHERE type LIKE 'offer.%'").all(),
    ).toEqual([{ type: "offer.requested" }]);
  });

  it("shows an operator the answers about specs and logs only as yes, no or not sure, and marks it reviewed with the request", async () => {
    const id = (await submit(clean())).json().requestId as string;
    const op = {
      userId: "u",
      actorType: "human" as const,
      correlationId: null,
      permissions: FOUNDATION_ROLE_PERMISSIONS.gtm_operator,
      now: () => fx.clock.now,
    };
    const detail = fx.engagement.requests.get(op, id);
    expect(detail.intake).toMatchObject({
      specsAvailable: "yes",
      scrubbedRejectionLogsAvailable: "no",
    });
    fx.engagement.requests.review(op, id, { action: "mark_reviewed" });
    expect(fx.db.raw.prepare("SELECT review_state FROM intake_submission").get()).toEqual({
      review_state: "reviewed",
    });
  });

  it("refuses a missing item and names it in plain words, storing nothing", async () => {
    const { organisationName: _o, ...rest } = clean();
    void _o;
    const res = await submit(rest);
    expect(res.statusCode).toBe(422);
    expect(res.json().codes).toEqual(["intake_invalid"]);
    expect(res.json().detail).toMatch(/organisation name/i);
    expect(count("offer_request")).toBe(0);
    expect(count("account")).toBe(0);
    expect(count("intake_submission")).toBe(0);
  });

  it("refuses a field the form does not have (budget, credentials, uploaded content)", async () => {
    for (const extra of [{ budget: "50000" }, { password: "x" }, { uploadedLog: "log text" }]) {
      expect((await submit({ ...clean(), ...extra })).statusCode).toBe(422);
    }
    expect(count("intake_submission")).toBe(0);
  });

  it("refuses patient-like data, production data and credentials in any text, storing and logging nothing (V29)", async () => {
    const attempts = [
      { ...clean(), knownDelays: ["Patient SSN 123-45-6789 was rejected"] },
      {
        ...clean(),
        recentOnboarding: {
          ...clean().recentOnboarding,
          formatAndGuide: "login with password=hunter2secret",
        },
      },
      {
        ...clean(),
        knownDelays: [
          "name,mrn,dob,diagnosis\nJordan Testcase,00123456,03/14/1971,asthma\nAvery Exampleton,00123457,05/02/1980,copd",
        ],
      },
    ];
    for (const a of attempts) expect((await submit(a)).statusCode).toBe(422);
    expect(count("offer_request")).toBe(0);
    expect(count("intake_submission")).toBe(0);
    expect(count("consent_record")).toBe(0);
    expect(count("phi_guard_decision")).toBe(3);
    expect(JSON.stringify(fx.db.raw.prepare("SELECT * FROM audit_event").all())).not.toMatch(
      /123-45-6789|hunter2|Testcase/,
    );
  });

  it("does not take an intake on a form that has no intake, or the wrong schema for the form", async () => {
    const form = (
      await fx.app.inject({
        method: "GET",
        url: "/api/v1/public/offers/ccda-to-fhir-mapping-decision-register/form",
      })
    ).json();
    fx.clock.now = new Date(fx.clock.now.getTime() + 5000);
    const res = await fx.app.inject({
      method: "POST",
      url: "/api/v1/public/offers/ccda-to-fhir-mapping-decision-register/requests",
      payload: {
        kind: "intake",
        formToken: form.formToken,
        noticeVersionId: form.notice.versionId,
        website: "",
        contact: {
          email: "a@newco.example",
          role: "Lead",
          orgName: "Newco",
          orgType: "health_system",
        },
        intake: clean(),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().codes).toEqual(["kind_not_available"]);
  });
});
