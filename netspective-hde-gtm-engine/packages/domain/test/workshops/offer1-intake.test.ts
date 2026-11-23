import { describe, expect, it } from "vitest";
import {
  OFFER1_SCHEMA_VERSION,
  Offer1IntakeSchema,
  validateOffer1,
} from "../../src/workshops/intake.js";

// Task T059 (spec FR-025, FR-033): the Offer 1 intake asks for no PHI, production data, credentials or budget.
const clean = {
  programType: "health_information_exchange",
  organisationName: "Northvale HIE",
  recentOnboarding: {
    senderLabel: "A regional hospital sender",
    formatAndGuide: "CCDA R2.1 against the 2026 implementation guide",
    timelineAndStages: "Six weeks: connectivity, test files, validation, go-live",
  },
  knownDelays: ["Validation failures on the encounter section", "Late sample files"],
  attendingRoles: ["Integration lead", "Onboarding manager"],
  specsAvailable: "yes",
  scrubbedRejectionLogsAvailable: "unsure",
};

describe("Offer 1 intake", () => {
  it("accepts a complete, clean intake at schema version 1", () => {
    expect(OFFER1_SCHEMA_VERSION).toBe(1);
    expect(validateOffer1(clean)).toEqual({
      ok: true,
      kind: "offer_1",
      schemaVersion: 1,
      payload: clean,
    });
  });
  it("accepts an intake without the optional known delays", () => {
    const { knownDelays: _omitted, ...rest } = clean;
    void _omitted;
    expect(validateOffer1(rest).ok).toBe(true);
  });
  it("names each missing required item in plain words", () => {
    const { organisationName: _a, attendingRoles: _b, ...rest } = clean;
    void _a;
    void _b;
    const r = validateOffer1(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.messages.join(" ")).toMatch(/organisation name/i);
      expect(r.messages.join(" ")).toMatch(/attending roles/i);
    }
  });
  it("limits the lists and texts", () => {
    expect(validateOffer1({ ...clean, knownDelays: Array(11).fill("A delay") }).ok).toBe(false);
    expect(validateOffer1({ ...clean, attendingRoles: Array(11).fill("A role") }).ok).toBe(false);
    expect(validateOffer1({ ...clean, attendingRoles: [] }).ok).toBe(false);
    expect(
      validateOffer1({
        ...clean,
        recentOnboarding: { ...clean.recentOnboarding, formatAndGuide: "x".repeat(501) },
      }).ok,
    ).toBe(false);
    expect(validateOffer1({ ...clean, specsAvailable: "maybe" }).ok).toBe(false);
    expect(validateOffer1({ ...clean, programType: "somewhere" }).ok).toBe(false);
  });
  it("has no field for credentials, production data, price or budget, so none can be accepted", () => {
    for (const extra of [
      "password",
      "apiKey",
      "credentials",
      "productionData",
      "budget",
      "price",
      "fundingSource",
      "uploadedFile",
      "sampleRecords",
    ]) {
      expect(validateOffer1({ ...clean, [extra]: "x" }).ok, extra).toBe(false);
    }
    const keys = JSON.stringify(Object.keys(Offer1IntakeSchema.shape));
    expect(keys).not.toMatch(
      /password|secret|credential|budget|price|cost|fund|upload|record|patient/i,
    );
  });
  it("records the availability of specs and logs only as an answer, never as content", () => {
    expect(validateOffer1({ ...clean, specsAvailable: "an attached file" }).ok).toBe(false);
  });
});

describe("form fields", () => {
  it("name only keys of the schema and ask for no price, budget, credential, sample or upload", async () => {
    const { OFFER1_FORM_FIELDS, OFFER6_FORM_FIELDS, SESSION_FORM_FIELDS } =
      await import("../../src/workshops/forms.js");
    const { Offer6IntakeSchema } = await import("../../src/workshops/intake.js");
    const top = (k: string) => k.split(".")[0]!;
    for (const f of OFFER1_FORM_FIELDS)
      expect(Object.keys(Offer1IntakeSchema.shape), f.key).toContain(top(f.key));
    for (const f of OFFER6_FORM_FIELDS)
      expect(Object.keys(Offer6IntakeSchema.shape), f.key).toContain(top(f.key));
    for (const f of [...OFFER1_FORM_FIELDS, ...OFFER6_FORM_FIELDS, ...SESSION_FORM_FIELDS]) {
      expect(`${f.key} ${f.label}`).not.toMatch(
        /budget|price|cost|funding|password|credential|secret|sample (data|value)|upload|attach/i,
      );
    }
  });
});
