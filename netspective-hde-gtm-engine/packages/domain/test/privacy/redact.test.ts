import { describe, expect, it } from "vitest";
import { CANARY_PHI } from "../../test-support/canaries.js";
import { redactPhi, redactionPlaceholder } from "../../src/index.js";

describe("redactPhi", () => {
  it("leaves benign values untouched (same reference)", () => {
    const value = { note: "fields: patient_id, mrn, dob", n: 3 };
    expect(redactPhi(value)).toBe(value);
  });

  it("replaces a matching string with a rule-id placeholder and never keeps the text", () => {
    const out = redactPhi({ ok: "fine", bad: "ssn 000-12-3456" });
    expect(out).toEqual({ ok: "fine", bad: "[REDACTED:PHI.SSN]" });
    expect(JSON.stringify(out)).not.toContain("000-12-3456");
  });

  it("handles nested arrays and objects", () => {
    const out = redactPhi({ list: [{ t: CANARY_PHI }, "fine"] });
    expect(JSON.stringify(out)).not.toContain("Canaryfield");
    expect(JSON.stringify(out)).toContain("[REDACTED:");
  });

  it("replaces the whole value when the match only exists across fields", () => {
    const out = redactPhi({ name: "Patient: Casey Canaryfield", mrn: "MRN: 00987654" });
    expect(JSON.stringify(out)).not.toContain("00987654");
    expect(JSON.stringify(out)).not.toContain("Canaryfield");
  });

  it("builds sorted placeholders", () => {
    expect(redactionPlaceholder(["B", "A"])).toBe("[REDACTED:A,B]");
  });
});

describe("redaction placeholders are not themselves matches", () => {
  it("does not flag an already-redacted secret assignment", async () => {
    const { guardValue } = await import("../../src/index.js");
    expect(guardValue({ password: "[REDACTED]" }).decision).toBe("allow");
    expect(guardValue({ password: "[REDACTED:CRED.SECRET_ASSIGNMENT]" }).decision).toBe("allow");
    expect(guardValue({ password: "hunter2hunter2" }).decision).toBe("reject");
  });
});

describe("JSON embedded in strings", () => {
  it("is inspected as the structure it encodes", async () => {
    const { guardValue } = await import("../../src/index.js");
    const rows = JSON.stringify([
      { patient_name: "A Person", mrn: "00123456", dob: "1950-01-01" },
      { patient_name: "B Person", mrn: "00123457", dob: "1951-02-02" },
    ]);
    expect(guardValue(rows).rule_ids).toContain("PHI.TABULAR_ROWS");
    expect(guardValue({ cursor: rows }).rule_ids).toContain("PHI.TABULAR_ROWS");
    expect(guardValue("[1, 2, 3]").decision).toBe("allow");
    expect(guardValue("{not json").decision).toBe("allow");
  });
});
