import { describe, expect, it } from "vitest";
import {
  OFFER6_SCHEMA_VERSION,
  Offer6IntakeSchema,
  validateOffer6,
} from "../../src/workshops/intake.js";

// Task T063 (spec FR-026): exactly ten field names, never values.
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
const clean = {
  useCase: "Readmission risk model for the cardiology service",
  pilotOwner: "Director of analytics",
  sourceSystems: ["Epic Clarity", "LabLink"],
  fieldNames: names,
  dataLead: "Integration lead",
  fieldQualityConcerns: ["Dates arrive in two formats"],
  interfaceTypes: ["HL7 v2 ADT", "CCDA"],
  attendees: ["Data lead", "Pilot owner"],
};

describe("Offer 6 intake", () => {
  it("accepts a clean intake with ten field names at schema version 1", () => {
    expect(OFFER6_SCHEMA_VERSION).toBe(1);
    expect(validateOffer6(clean)).toEqual({
      ok: true,
      kind: "offer_6",
      schemaVersion: 1,
      payload: clean,
    });
  });
  it("refuses nine and eleven field names with a plain message about the count", () => {
    for (const n of [9, 11, 0]) {
      const list = Array.from({ length: n }, (_, i) => `field_${i}`);
      const r = validateOffer6({ ...clean, fieldNames: list });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.messages.join(" ")).toMatch(/exactly ten field names/i);
    }
  });
  it("refuses an entry that is a value, saying field names are needed, not values", () => {
    for (const value of [
      "1984-03-12",
      "John Smith 1234",
      "jane.doe@example.org",
      "1234567",
      "Patient has diabetes.",
    ]) {
      const r = validateOffer6({ ...clean, fieldNames: [...names.slice(0, 9), value] });
      expect(r.ok, value).toBe(false);
      if (!r.ok) expect(r.messages.join(" ")).toMatch(/field names, not values/i);
    }
  });
  it("names the entry that failed, by its position", () => {
    const r = validateOffer6({ ...clean, fieldNames: [names[0], "1984-03-12", ...names.slice(2)] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.messages.join(" ")).toMatch(/entry 2/i);
  });
  it("limits each text and list", () => {
    expect(validateOffer6({ ...clean, useCase: "x".repeat(201) }).ok).toBe(false);
    expect(validateOffer6({ ...clean, pilotOwner: "x".repeat(121) }).ok).toBe(false);
    expect(validateOffer6({ ...clean, sourceSystems: [] }).ok).toBe(false);
    expect(validateOffer6({ ...clean, sourceSystems: Array(11).fill("System") }).ok).toBe(false);
    expect(validateOffer6({ ...clean, attendees: [] }).ok).toBe(false);
    expect(validateOffer6({ ...clean, fieldQualityConcerns: Array(11).fill("A concern") }).ok).toBe(
      false,
    );
  });
  it("has no field for credentials, production data, values or budget", () => {
    for (const extra of ["password", "sampleValues", "records", "budget", "price", "apiKey"]) {
      expect(validateOffer6({ ...clean, [extra]: "x" }).ok, extra).toBe(false);
    }
    expect(JSON.stringify(Object.keys(Offer6IntakeSchema.shape))).not.toMatch(
      /password|secret|credential|budget|price|cost|value|sample|record/i,
    );
  });
});
