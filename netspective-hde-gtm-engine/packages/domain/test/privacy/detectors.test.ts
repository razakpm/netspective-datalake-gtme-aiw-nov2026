import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DATA_CLASSIFICATIONS,
  GUARD_VERSION,
  guardText,
  guardValue,
  isProhibitedClassification,
} from "../../src/privacy/index.js";
import { CANARY_PHI } from "../../test-support/canaries.js";

interface ProhibitedSample {
  id: string;
  kind: string;
  rules: string[];
  content: unknown;
}
interface BenignSample {
  id: string;
  expected: "allow";
  content: unknown;
}

const load = <T>(name: string): T[] =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../tests/fixtures/phi-samples/${name}`, import.meta.url),
      "utf8",
    ),
  ) as T[];

const prohibited = load<ProhibitedSample>("prohibited.json");
const benign = load<BenignSample>("benign.json");

const inspect = (content: unknown) =>
  typeof content === "string" ? guardText(content) : guardValue(content);

describe("data classification", () => {
  it("defines the six classifications and only `prohibited` is prohibited", () => {
    expect([...DATA_CLASSIFICATIONS]).toEqual([
      "public",
      "business_contact",
      "confidential_commercial",
      "internal_case_study_restricted",
      "sensitive_operational_metadata",
      "prohibited",
    ]);
    expect(DATA_CLASSIFICATIONS.filter(isProhibitedClassification)).toEqual(["prohibited"]);
  });
});

describe("PHI guard: prohibited samples", () => {
  it.each(prohibited.map((s) => [s.id, s] as const))("rejects %s", (_id, sample) => {
    const decision = inspect(sample.content);
    expect(decision.decision).toBe("reject");
    for (const rule of sample.rules) {
      expect(decision.rule_ids).toContain(rule);
    }
    expect(decision.guard_version).toBe(GUARD_VERSION);
  });

  it("never includes matched content in a decision", () => {
    for (const sample of prohibited) {
      const serialised = JSON.stringify(inspect(sample.content));
      const raw =
        typeof sample.content === "string" ? sample.content : JSON.stringify(sample.content);
      for (const token of raw
        .split(/[\s,:"{}[\]]+/)
        .filter((t) => /\d{4,}|[A-Z][a-z]{5,}/.test(t))) {
        expect(serialised).not.toContain(token);
      }
    }
  });

  it("covers every required category", () => {
    const kinds = new Set(prohibited.map((s) => s.kind));
    for (const kind of ["ssn", "mrn_with_name", "dob_with_name", "tabular_rows", "credential"]) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  it("flags the PHI canary used by log-scan tests", () => {
    expect(guardText(CANARY_PHI).decision).toBe("reject");
  });
});

describe("PHI guard: benign near-misses", () => {
  it.each(benign.map((s) => [s.id, s] as const))("allows %s", (_id, sample) => {
    const decision = inspect(sample.content);
    expect(decision).toEqual({ decision: "allow", rule_ids: [], guard_version: GUARD_VERSION });
  });
});

describe("PHI guard: decisions", () => {
  it("is deterministic", () => {
    const sample = prohibited[2]!.content as string;
    expect(guardText(sample)).toEqual(guardText(sample));
  });

  it("returns the configured action on a match", () => {
    expect(guardText("SSN 000-12-3456", { onMatch: "quarantine" }).decision).toBe("quarantine");
    expect(guardText("SSN 000-12-3456", { onMatch: "reject" }).decision).toBe("reject");
    expect(guardText("SSN 000-12-3456").decision).toBe("reject");
  });

  it("sorts and de-duplicates rule ids", () => {
    const decision = guardText(
      "SSN 000-12-3456 and again 000-12-3457 plus password = Sup3rS3cretValue99",
    );
    expect(decision.rule_ids).toEqual([...new Set(decision.rule_ids)].sort());
    expect(decision.rule_ids).toEqual(["CRED.SECRET_ASSIGNMENT", "PHI.SSN"]);
  });

  it("rejects unclassifiable input instead of accepting it (spec FR-022)", () => {
    expect(guardText("bad\u0000byte").rule_ids).toContain("GUARD.UNCLASSIFIABLE");
    expect(guardText("x".repeat(2_000), { maxBytes: 1_000 }).decision).toBe("reject");

    let deep: unknown = "leaf";
    for (let i = 0; i < 50; i += 1) deep = { next: deep };
    expect(guardValue(deep).rule_ids).toContain("GUARD.UNCLASSIFIABLE");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(guardValue(circular).decision).toBe("reject");

    for (const value of [10n, () => 1, Symbol("x"), new Uint8Array([1, 2, 3])]) {
      expect(guardValue({ value }).rule_ids).toContain("GUARD.UNCLASSIFIABLE");
    }
  });

  it("allows primitives and empty values", () => {
    for (const value of [null, undefined, 42, true, "", [], {}]) {
      expect(guardValue(value).decision).toBe("allow");
    }
  });
});
