import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T064 (quickstart V30, SC-005): the Offer 6 intake over HTTP: ten field names, never values.
const SLUG = "pilot-input-trace-workshop";
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
const names = [
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
const clean = (fieldNames: string[] = names) => ({
  useCase: "Readmission risk model for the cardiology service",
  pilotOwner: "Director of analytics",
  sourceSystems: ["Epic Clarity", "LabLink"],
  fieldNames,
  dataLead: "Integration lead",
  fieldQualityConcerns: ["Dates arrive in two formats"],
  interfaceTypes: ["HL7 v2 ADT"],
  attendees: ["Data lead", "Pilot owner"],
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
        email: "casey@riverbend-health.example",
        role: "Chief Data Officer",
        orgName: "Riverbend Health",
        orgType: "health_system",
      },
      intake,
    },
  });
}

describe("the Offer 6 form", () => {
  it("asks for ten field names and nothing about credentials, production data or budget", async () => {
    const form = (
      await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
    ).json();
    const fields = form.fields.intake as {
      key: string;
      type: string;
      minItems?: number;
      maxItems?: number;
    }[];
    expect(fields.find((f) => f.key === "fieldNames")).toMatchObject({
      type: "names",
      minItems: 10,
      maxItems: 10,
    });
    expect(JSON.stringify(fields)).not.toMatch(
      /budget|price|cost|funding|password|credential|production data/i,
    );
  });
});

describe("Offer 6 intake submissions", () => {
  it("accepts ten clean field names and queues them for review, labelled non-PHI", async () => {
    const res = await submit(clean());
    expect(res.statusCode).toBe(201);
    const row = fx.db.raw
      .prepare("SELECT kind, classification, review_state, payload_json FROM intake_submission")
      .get() as Record<string, string>;
    expect(row).toMatchObject({
      kind: "offer_6",
      classification: "non_phi",
      review_state: "pending",
    });
    expect(JSON.parse(row["payload_json"]!).fieldNames).toEqual(names);
  });

  it("refuses nine and eleven field names with a plain message, storing nothing", async () => {
    for (const n of [9, 11]) {
      const res = await submit(clean(Array.from({ length: n }, (_, i) => `field_${i}`)));
      expect(res.statusCode).toBe(422);
      expect(res.json().detail).toMatch(/exactly ten field names/i);
    }
    expect(count("intake_submission")).toBe(0);
    expect(count("offer_request")).toBe(0);
  });

  it("refuses an entry that is a value, explaining that field names are needed, not values", async () => {
    for (const value of [
      "1984-03-12",
      "John Smith 1234",
      "jane.doe@example.org",
      "Patient has diabetes.",
    ]) {
      const res = await submit(clean([...names.slice(0, 9), value]));
      expect(res.statusCode, value).toBe(422);
      expect(res.json().detail).toMatch(/field names, not values/i);
    }
    expect(count("intake_submission")).toBe(0);
  });

  it("blocks sample patient values with the content guard: nothing stored, logged or sent (SC-005)", async () => {
    const samples = [
      [...names.slice(0, 9), "Patient: Jordan Testcase, MRN: 00123456"],
      [...names.slice(0, 9), "Name: Avery Exampleton  DOB: 03/14/1971"],
      [...names.slice(0, 9), "SSN 123-45-6789"],
    ];
    for (const s of samples) expect((await submit(clean(s))).statusCode).toBe(422);
    expect(
      (
        await submit({
          ...clean(),
          fieldQualityConcerns: [
            "patient_name,mrn,dob\nJordan Testcase,00123456,03/14/1971\nAvery Exampleton,00123457,05/02/1980",
          ],
        })
      ).statusCode,
    ).toBe(422);
    expect(count("intake_submission")).toBe(0);
    expect(count("offer_request")).toBe(0);
    expect(count("account")).toBe(0);
    expect(count("consent_record")).toBe(0);
    expect(count("phi_guard_decision")).toBe(4);
    expect(count("outbox_event", "type = 'offer.requested'")).toBe(0);
    expect(
      JSON.stringify([
        fx.db.raw.prepare("SELECT * FROM audit_event").all(),
        fx.db.raw.prepare("SELECT * FROM phi_guard_decision").all(),
      ]),
    ).not.toMatch(/Testcase|Exampleton|123-45-6789/);
  });

  it("refuses credentials, values and budget fields the form does not have", async () => {
    for (const extra of [{ sampleValues: ["1", "2"] }, { password: "x" }, { budget: "1" }]) {
      expect((await submit({ ...clean(), ...extra })).statusCode).toBe(422);
    }
    expect(count("intake_submission")).toBe(0);
  });
});
