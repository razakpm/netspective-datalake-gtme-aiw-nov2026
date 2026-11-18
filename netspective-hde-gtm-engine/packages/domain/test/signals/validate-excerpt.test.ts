import { describe, expect, it } from "vitest";
import {
  applyExcerptRule,
  deriveSensitivity,
  effectiveExcerptLimit,
  validateNewSignal,
  type NewSignalInput,
} from "../../src/index.js";

const base: NewSignalInput = {
  hasSource: true,
  sourceRef: "https://example.org/notice/1",
  observation: "The exchange published an updated implementation guide.",
  observedAt: "2026-11-01T00:00:00.000Z",
  evidenceStatus: "observed",
  extractionMethod: "manual",
  extractionConfidence: "high",
  actorKind: "human",
  sourceKind: "official_publication",
};
const codes = (over: Partial<NewSignalInput>) =>
  validateNewSignal({ ...base, ...over }).map((r) => r.code);

describe("validateNewSignal", () => {
  it("accepts a complete manual signal", () => expect(codes({})).toEqual([]));
  it("refuses a missing source and reference", () => {
    expect(codes({ hasSource: false })).toContain("source_required");
    expect(codes({ sourceRef: "  " })).toContain("source_reference_required");
  });
  it("limits the observation, and treats conclusion-like text as plain observation", () => {
    expect(codes({ observation: "x".repeat(1001) })).toContain("observation_too_long");
    expect(
      codes({ observation: "This organisation is a strong ICP fit and they will buy" }),
    ).toEqual([]);
    expect(codes({ observation: " " })).toContain("observation_required");
  });
  it("checks dates", () => {
    expect(codes({ observedAt: "nope" })).toContain("invalid_date");
    expect(codes({ publishedAt: "nope" })).toContain("invalid_date");
  });
  it("requires model and prompt version for AI extraction", () => {
    const r = codes({ extractionMethod: "ai_extracted", actorKind: "ai" });
    expect(r).toContain("ai_model_required");
    expect(r).toContain("ai_prompt_version_required");
    expect(
      codes({
        extractionMethod: "ai_extracted",
        actorKind: "ai",
        aiModel: "m",
        aiPromptVersion: "v1",
      }),
    ).toEqual([]);
  });
  it("lets only a human, manual entry from a buyer statement be buyer_confirmed", () => {
    const bc = { evidenceStatus: "buyer_confirmed" as const };
    expect(codes({ ...bc, sourceKind: "buyer_statement" })).toEqual([]);
    expect(codes({ ...bc, sourceKind: "official_publication" })).toContain(
      "buyer_confirmed_not_allowed",
    );
    expect(codes({ ...bc, sourceKind: "buyer_statement", actorKind: "ai" })).toContain(
      "buyer_confirmed_not_allowed",
    );
    expect(
      codes({
        ...bc,
        sourceKind: "buyer_statement",
        actorKind: "system",
        extractionMethod: "provider",
      }),
    ).toContain("buyer_confirmed_not_allowed");
  });
  it("refuses a reliability override from a non-human and a human provider method", () => {
    expect(codes({ reliabilityOverride: "high", actorKind: "ai" })).toContain(
      "reliability_override_not_allowed",
    );
    expect(codes({ extractionMethod: "provider" })).toContain("provider_method_reserved");
  });
  it("validates advisory tags", () => {
    expect(
      codes({ tags: { icp: ["icp1"], capability: ["fhir_mapping"], offer: ["audit"] } }),
    ).toEqual([]);
    expect(codes({ tags: { icp: ["icp3"] } })).toContain("invalid_tag");
    expect(codes({ tags: { capability: ["Bad Key"] } })).toContain("invalid_tag");
    expect(codes({ tags: { offer: ["x".repeat(61)] } })).toContain("invalid_tag");
  });
  it("derives a permitted sensitivity, never prohibited", () => {
    expect(deriveSensitivity({ sourceKind: "official_publication", hasContact: false })).toBe(
      "public",
    );
    expect(deriveSensitivity({ sourceKind: "official_publication", hasContact: true })).toBe(
      "confidential_commercial",
    );
    expect(deriveSensitivity({ sourceKind: null, hasContact: false })).toBe("business_contact");
  });
});

describe("excerpt rule", () => {
  const open = { storageRule: "excerpt" as const, excerptMaxChars: null };
  it("uses the shorter of the global and source limit", () => {
    expect(effectiveExcerptLimit(300, open)).toBe(300);
    expect(effectiveExcerptLimit(300, { storageRule: "excerpt", excerptMaxChars: 100 })).toBe(100);
    expect(effectiveExcerptLimit(300, { storageRule: "excerpt", excerptMaxChars: 900 })).toBe(300);
    expect(effectiveExcerptLimit(300, { storageRule: "citation_only", excerptMaxChars: 50 })).toBe(
      0,
    );
  });
  it("stores, withholds as too long, and withholds for no-storage sources", () => {
    expect(applyExcerptRule("short", 300, open)).toEqual({
      excerpt: "short",
      withheldReason: "none",
    });
    expect(applyExcerptRule("a".repeat(300), 300, open).excerpt).not.toBeNull();
    expect(applyExcerptRule("a".repeat(301), 300, open)).toEqual({
      excerpt: null,
      withheldReason: "too_long",
    });
    expect(
      applyExcerptRule("text", 300, { storageRule: "citation_only", excerptMaxChars: null }),
    ).toEqual({
      excerpt: null,
      withheldReason: "source_no_storage",
    });
    expect(applyExcerptRule(undefined, 300, open)).toEqual({
      excerpt: null,
      withheldReason: "none",
    });
  });
});
