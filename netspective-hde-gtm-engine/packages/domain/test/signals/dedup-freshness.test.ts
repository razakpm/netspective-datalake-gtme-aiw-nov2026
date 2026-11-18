import { describe, expect, it } from "vitest";
import {
  canonicaliseSourceRef,
  contentFingerprint,
  decideDuplicate,
  freshAnchor,
  freshUntil,
  independentSourceCount,
  isCurrentEvidence,
  isStale,
  isUndated,
  normaliseObservation,
  textSimilarity,
  type DedupCandidate,
} from "../../src/index.js";

describe("normalise, fingerprint, similarity", () => {
  it("normalises case, punctuation and spacing", () => {
    expect(normaliseObservation("  The Exchange, published: IG v2! ")).toBe(
      "the exchange published ig v2",
    );
  });
  it("fingerprints on account, type and normalised text but not the source", () => {
    const a = contentFingerprint("acc", "t", "Hello, World");
    expect(a).toBe(contentFingerprint("acc", "t", "hello   world"));
    expect(a).not.toBe(contentFingerprint("acc2", "t", "hello world"));
    expect(a).not.toBe(contentFingerprint("acc", "t2", "hello world"));
  });
  it("canonicalises source references", () => {
    expect(canonicaliseSourceRef("HTTPS://Example.ORG/a/b/?utm_source=x#frag")).toBe(
      "https://example.org/a/b",
    );
    expect(canonicaliseSourceRef("RFP-2026-17")).toBe("RFP-2026-17");
  });
  it("scores identical 1, light rewording high, different low, symmetric", () => {
    expect(textSimilarity("same text here", "Same text, here")).toBe(1);
    const a = "The exchange issued a request for proposals for a new data platform.";
    const b = "The exchange issued a request for proposals for a new data platform";
    expect(textSimilarity(a, b)).toBeGreaterThanOrEqual(0.85);
    expect(textSimilarity(a, "Hospital hired a new chief data officer last week")).toBeLessThan(
      0.5,
    );
    expect(textSimilarity(a, "other words")).toBe(textSimilarity("other words", a));
    expect(textSimilarity("", "x")).toBe(0);
  });
});

const cand = (over: Partial<DedupCandidate> & { id: string }): DedupCandidate => ({
  accountId: "a1",
  typeKey: "procurement_notice",
  sourceId: "s1",
  itemKey: null,
  observationNormalised: "request for proposals for a new data platform",
  seen: [{ fingerprint: "fp1", sourceId: "s1" }],
  ...over,
});
const input = (over = {}) => ({
  accountId: "a1",
  typeKey: "procurement_notice",
  sourceId: "s1",
  itemKey: null as string | null,
  fingerprint: "fp-new",
  observation: "A completely different observation about staffing",
  ...over,
});

describe("decideDuplicate", () => {
  it("is identical for the same fingerprint from the same source", () => {
    expect(decideDuplicate(input({ fingerprint: "fp1" }), [cand({ id: "x" })], 0.85)).toEqual({
      kind: "identical",
      signalId: "x",
    });
  });
  it("is a republication for the same content from another source", () => {
    expect(
      decideDuplicate(input({ fingerprint: "fp1", sourceId: "s2" }), [cand({ id: "x" })], 0.85),
    ).toEqual({
      kind: "merge",
      signalId: "x",
      reason: "republication",
    });
  });
  it("is a republication for a shared item key even with different text", () => {
    const c = cand({ id: "x", itemKey: "RFP-1" });
    expect(decideDuplicate(input({ itemKey: "RFP-1", sourceId: "s2" }), [c], 0.85)).toMatchObject({
      kind: "merge",
      reason: "republication",
    });
  });
  it("merges a near-duplicate only from the same source, at or above the threshold", () => {
    const text = "request for proposals for a new data platform!";
    const same = decideDuplicate(input({ observation: text }), [cand({ id: "x" })], 0.85);
    expect(same).toMatchObject({ kind: "merge", reason: "duplicate" });
    expect(
      decideDuplicate(input({ observation: text, sourceId: "s2" }), [cand({ id: "x" })], 0.85),
    ).toEqual({ kind: "new" });
    expect(decideDuplicate(input({ observation: text }), [cand({ id: "x" })], 1.01)).toEqual({
      kind: "new",
    });
  });
  it("keeps different accounts and types apart and is idempotent after a merge", () => {
    expect(
      decideDuplicate(input({ fingerprint: "fp1", accountId: "a2" }), [cand({ id: "x" })], 0.85),
    ).toEqual({ kind: "new" });
    expect(
      decideDuplicate(input({ fingerprint: "fp1", typeKey: "other" }), [cand({ id: "x" })], 0.85),
    ).toEqual({ kind: "new" });
    const merged = cand({
      id: "x",
      seen: [
        { fingerprint: "fp1", sourceId: "s1" },
        { fingerprint: "fp2", sourceId: "s1" },
      ],
    });
    expect(decideDuplicate(input({ fingerprint: "fp2" }), [merged], 0.85)).toEqual({
      kind: "identical",
      signalId: "x",
    });
  });
  it("counts independent sources by distinct signals", () => {
    expect(independentSourceCount(["x", "x", "y"])).toBe(2);
  });
});

describe("freshness", () => {
  const dates = {
    publishedAt: null,
    collectedAt: "2026-06-01T00:00:00.000Z",
    observedAt: "2026-05-01T00:00:00.000Z",
    kind: "general" as const,
  };
  it("anchors on published, else collected, else observed for first-party", () => {
    expect(freshAnchor({ ...dates, publishedAt: "2026-05-15T00:00:00.000Z" })).toBe(
      "2026-05-15T00:00:00.000Z",
    );
    expect(freshAnchor(dates)).toBe(dates.collectedAt);
    expect(freshAnchor({ ...dates, kind: "first_party" })).toBe(dates.observedAt);
    expect(isUndated(dates)).toBe(true);
    expect(isUndated({ ...dates, kind: "first_party" })).toBe(false);
  });
  it("is stale exactly at fresh_until and deterministic", () => {
    const until = freshUntil("2026-01-01T00:00:00.000Z", 90);
    expect(until).toBe("2026-04-01T00:00:00.000Z");
    expect(isStale(until, new Date("2026-03-31T23:59:59.999Z"))).toBe(false);
    expect(isStale(until, new Date("2026-04-01T00:00:00.000Z"))).toBe(true);
    const now = new Date("2026-02-01T00:00:00.000Z");
    expect(isStale(until, now)).toBe(isStale(until, now));
  });
  it("counts only approved, fresh, unpurged signals as current evidence", () => {
    const now = new Date("2026-02-01T00:00:00.000Z");
    const fresh = "2026-04-01T00:00:00.000Z";
    expect(
      isCurrentEvidence({ reviewStatus: "approved", freshUntil: fresh, purged: false }, now),
    ).toBe(true);
    for (const reviewStatus of ["pending", "rejected", "contradictory"] as const) {
      expect(isCurrentEvidence({ reviewStatus, freshUntil: fresh, purged: false }, now)).toBe(
        false,
      );
    }
    expect(
      isCurrentEvidence(
        { reviewStatus: "approved", freshUntil: "2026-01-01T00:00:00.000Z", purged: false },
        now,
      ),
    ).toBe(false);
    expect(
      isCurrentEvidence({ reviewStatus: "approved", freshUntil: fresh, purged: true }, now),
    ).toBe(false);
  });
});
