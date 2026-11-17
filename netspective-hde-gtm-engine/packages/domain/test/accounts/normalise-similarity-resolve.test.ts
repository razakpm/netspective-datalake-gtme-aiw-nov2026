import { describe, expect, it } from "vitest";
import {
  detectCandidates,
  isExcludedOrgType,
  nameSimilarity,
  normaliseDomain,
  normaliseEmail,
  normaliseName,
  similarityKey,
  type MatchAccount,
} from "../../src/index.js";

const acct = (over: Partial<MatchAccount> & { id: string; name: string }): MatchAccount => ({
  aliases: [],
  domains: [],
  orgType: "health_system",
  geography: null,
  ...over,
});

describe("normalisers", () => {
  it("normalises domains and rejects non-hostnames", () => {
    expect(normaliseDomain(" WWW.Example.ORG. ")).toBe("example.org");
    for (const bad of [
      "https://x.example/path",
      "x",
      "a b.example",
      "x.example/path",
      "",
      "-a.example",
    ]) {
      expect(normaliseDomain(bad)).toBeNull();
    }
  });
  it("normalises names and email", () => {
    expect(normaliseName("The Riverbend Health, Inc.")).toBe("riverbend health");
    expect(similarityKey("Riverbend Health System")).toBe("riverbend");
    expect(normaliseEmail(" Pat@Example.ORG ")).toBe("pat@example.org");
    expect(normaliseEmail("not an email")).toBeNull();
  });
  it("knows the excluded organisation types (FR-027)", () => {
    expect(
      ["medtech", "payer", "multi_site_practice", "biotech"].every((t) =>
        isExcludedOrgType(t as never),
      ),
    ).toBe(true);
    expect(isExcludedOrgType("health_system")).toBe(false);
  });
});

describe("similarity", () => {
  it("is 1 for names that differ only in generic words and deterministic", () => {
    expect(nameSimilarity("Riverbend Health", "Riverbend Health System")).toBe(1);
    expect(
      nameSimilarity("Prairie Medicaid Operations", "Prairie Medicaid Operation"),
    ).toBeGreaterThanOrEqual(0.8);
    expect(nameSimilarity("Northvale", "Lakeshore")).toBeLessThan(0.3);
    expect(nameSimilarity("a b", "c d")).toBe(nameSimilarity("a b", "c d"));
  });
});

describe("candidate detection (FR-004, FR-008)", () => {
  const existing = [
    acct({
      id: "x1",
      name: "Northvale Health Information Exchange",
      domains: [{ domain: "northvale-hie.example", shared: false }],
      orgType: "health_information_exchange",
      geography: "Midwest region",
    }),
    acct({
      id: "x2",
      name: "Riverbend Health",
      domains: [{ domain: "riverbend-health.example", shared: false }],
      geography: "River valley",
    }),
    acct({
      id: "x3",
      name: "SummitCare Health",
      aliases: ["Summit Care"],
      geography: "Mountain region",
    }),
  ];

  it("always flags an exact non-shared domain match", () => {
    const c = detectCandidates(
      acct({
        id: "n",
        name: "Totally Different",
        orgType: "payer",
        domains: [{ domain: "northvale-hie.example", shared: false }],
      }),
      existing,
    );
    expect(c).toEqual([{ matchedId: "x1", reasons: ["domain_match"], score: 1 }]);
  });

  it("flags similar names only when type or geography also matches", () => {
    const sameType = detectCandidates(
      acct({ id: "n", name: "Riverbend Health System", geography: "Elsewhere" }),
      existing,
    );
    expect(sameType.map((c) => [c.matchedId, c.reasons])).toEqual([["x2", ["name_similarity"]]]);
    const sameGeo = detectCandidates(
      acct({
        id: "n",
        name: "Riverbend Health System",
        orgType: "payer",
        geography: "river valley",
      }),
      existing,
    );
    expect(sameGeo.map((c) => c.matchedId)).toEqual(["x2"]);
    const neither = detectCandidates(
      acct({ id: "n", name: "Summitcare Health Group", orgType: "payer", geography: "Far away" }),
      existing,
    );
    expect(neither).toEqual([]);
  });

  it("does not use name similarity alone, and treats unknown type as no type match", () => {
    expect(
      detectCandidates(
        acct({ id: "n", name: "Riverbend Health", orgType: "unknown", geography: null }),
        existing,
      ),
    ).toEqual([]);
  });

  it("never flags on a shared domain alone", () => {
    const a = acct({
      id: "a",
      name: "Shared Domain Hospital",
      domains: [{ domain: "shared-portal.example", shared: true }],
    });
    const b = acct({
      id: "b",
      name: "Other Name Entirely",
      orgType: "health_information_exchange",
      domains: [{ domain: "shared-portal.example", shared: false }],
    });
    expect(detectCandidates(b, [a])).toEqual([]);
  });

  it("matches a former name kept as an alias", () => {
    const renamed = acct({
      id: "r",
      name: "Riverbend Regional",
      aliases: ["Old Lakeview Medical"],
    });
    const c = detectCandidates(acct({ id: "n", name: "Old Lakeview Medical" }), [renamed]);
    expect(c[0]?.reasons).toContain("alias_match");
  });

  it("is deterministic and ignores itself", () => {
    const incoming = acct({ id: "x2", name: "Riverbend Health" });
    expect(detectCandidates(incoming, existing)).toEqual(detectCandidates(incoming, existing));
    expect(detectCandidates(incoming, existing).some((c) => c.matchedId === "x2")).toBe(false);
  });
});
