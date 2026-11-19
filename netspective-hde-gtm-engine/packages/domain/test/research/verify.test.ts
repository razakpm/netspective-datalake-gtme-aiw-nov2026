import { describe, expect, it } from "vitest";
import {
  PROTECTED_RESEARCH_TOPICS,
  matchApprovedRule,
  normaliseAddress,
  verifyFindings,
  type VerifiableFinding,
  type VerifierSource,
} from "../../src/index.js";

// Tasks T023 and T031: approved-source matching, address normalisation and the deterministic verifier
// (cited fetched source, quote present in the source, protected topics only as verified facts, unknowns
// completed, taxonomy, entity match). Pure and deterministic.
const rule = (
  id: string,
  matchType: "host" | "host_suffix",
  pattern: string,
  status: "enabled" | "disabled" = "enabled",
) => ({ id, matchType, pattern, status });

describe("normaliseAddress", () => {
  it("lower-cases the host, drops fragment and tracking parameters, trims the trailing slash and needs https", () => {
    expect(normaliseAddress("https://News.Example.ORG/a/b/?utm_source=x&b=2&a=1#frag")).toBe(
      "https://news.example.org/a/b?a=1&b=2",
    );
    expect(normaliseAddress("https://x.example/")).toBe("https://x.example");
    for (const bad of [
      "http://x.example/",
      "ftp://x.example/",
      "not a url",
      "",
      "https://",
      "https://user:pw@x.example/",
    ])
      expect(normaliseAddress(bad), bad).toBeNull();
  });
});

describe("matchApprovedRule", () => {
  const rules = [
    rule("r1", "host", "www.northvale-hie.example"),
    rule("r2", "host_suffix", "evidence.example"),
    rule("r3", "host", "off.example", "disabled"),
  ];
  it("matches exact hosts and suffixes of enabled rules only", () => {
    expect(matchApprovedRule("https://www.northvale-hie.example/p", rules)?.id).toBe("r1");
    expect(matchApprovedRule("https://evidence.example/a", rules)?.id).toBe("r2");
    expect(matchApprovedRule("https://a.b.evidence.example/a", rules)?.id).toBe("r2");
    expect(matchApprovedRule("https://off.example/", rules)).toBeNull();
    expect(matchApprovedRule("http://www.northvale-hie.example/", rules)).toBeNull();
  });
  it("does not match look-alike hosts", () => {
    for (const a of [
      "https://evidence.example.evil.example/",
      "https://notevidence.example/",
      "https://www.northvale-hie.example.evil.example/",
      "https://evil.example/www.northvale-hie.example",
    ]) {
      expect(matchApprovedRule(a, rules), a).toBeNull();
    }
  });
});

const sources: VerifierSource[] = [
  {
    fetchId: "f1",
    address: "https://news.northvale-hie.example/a",
    text: "Northvale HIE reports that senders submit data in three formats: CCDA, HL7 v2 and CSV extracts.",
    read: true,
  },
  {
    fetchId: "f2",
    address: "https://docs.northvale-hie.example/b",
    text: "Northvale HIE published an updated implementation guide for claims attachments.",
    read: true,
  },
  {
    fetchId: "f3",
    address: "https://other.example/c",
    text: "A page that mentions nothing about the account at all.",
    read: true,
  },
  { fetchId: "f4", address: "https://blocked.example/d", text: "", read: false },
];
const ctx = {
  sources,
  allowedTypeKeys: new Set([
    "multi_format_sender",
    "implementation_guide_change",
    "onboarding_delay",
  ]),
  account: { name: "Northvale HIE", domains: ["northvale-hie.example"] },
};
const fact = (over: Partial<VerifiableFinding> = {}): VerifiableFinding => ({
  key: "k1",
  kind: "fact",
  topic: "other",
  statement: "Senders use three formats.",
  supportingText: "three formats: CCDA, HL7 v2 and CSV extracts",
  sourceFetchId: "f1",
  typeKey: "multi_format_sender",
  extractionConfidence: "high",
  ...over,
});
const run = (findings: VerifiableFinding[]) => verifyFindings({ ...ctx, findings });

describe("verifyFindings", () => {
  it("keeps a fact whose quote is present in its fetched source and returns the quote hash", () => {
    const r = run([fact()]);
    expect(r.kept.map((k) => k.key)).toEqual(["k1"]);
    expect(r.kept[0]).toMatchObject({
      verified: true,
      supportingText: "three formats: CCDA, HL7 v2 and CSV extracts",
      sourceFetchId: "f1",
    });
    expect(r.kept[0]!.supportingTextSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.dropped).toEqual({ uncited: 0, unsupported: 0, protectedTopic: 0, taxonomy: 0 });
  });
  it("matches quotes ignoring case, punctuation and spacing", () => {
    expect(
      run([fact({ supportingText: "THREE  formats,  ccda hl7 v2 AND csv extracts" })]).kept,
    ).toHaveLength(1);
  });
  it("drops findings citing a source that was not read, or does not exist", () => {
    const r = run([
      fact({ key: "a", sourceFetchId: "f4" }),
      fact({ key: "b", sourceFetchId: "never-fetched" }),
    ]);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped.uncited).toBe(2);
  });
  it("drops a fact whose quote is not in its source", () => {
    const r = run([fact({ supportingText: "a quantum ledger deployment" })]);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped.unsupported).toBe(1);
  });
  it("on protected topics keeps only a verified fact and drops inferences and unsupported statements", () => {
    const r = run([
      fact({ key: "p1", topic: "budget", supportingText: "budget of 4 million" }),
      fact({
        key: "p2",
        topic: "source_systems",
        supportingText: "three formats: CCDA, HL7 v2 and CSV extracts",
        statement: "Source systems include CCDA feeds.",
      }),
      {
        key: "p3",
        kind: "inference",
        topic: "data_architecture",
        statement: "They run a central lake.",
        basisKeys: ["p2"],
        extractionConfidence: "low",
      },
    ]);
    expect(r.kept.map((k) => k.key)).toEqual(["p2"]);
    expect(r.dropped).toMatchObject({ unsupported: 1, protectedTopic: 1 });
  });
  it("always lists the five protected topics that no verified fact covers as unknowns", () => {
    const r = run([fact({ key: "p2", topic: "source_systems" })]);
    expect(r.unknowns.map((u) => u.topic).sort()).toEqual([
      "budget",
      "buying_authority",
      "data_architecture",
      "project_status",
    ]);
    expect(
      run([])
        .unknowns.map((u) => u.topic)
        .sort(),
    ).toEqual([...PROTECTED_RESEARCH_TOPICS].sort());
    // A model-supplied unknown is kept once, not duplicated.
    const withModelUnknown = run([
      {
        key: "u1",
        kind: "unknown",
        topic: "budget",
        statement: "No budget is stated.",
        extractionConfidence: "low",
      },
    ]);
    expect(withModelUnknown.unknowns.filter((u) => u.topic === "budget")).toHaveLength(1);
  });
  it("needs an inference's basis findings to be kept", () => {
    const ok = run([
      fact(),
      {
        key: "i1",
        kind: "inference",
        topic: "other",
        statement: "Senders may need guidance.",
        basisKeys: ["k1"],
        typeKey: "onboarding_delay",
        extractionConfidence: "medium",
      },
    ]);
    expect(ok.kept.map((k) => k.key)).toEqual(["k1", "i1"]);
    const bad = run([
      {
        key: "i2",
        kind: "inference",
        topic: "other",
        statement: "Senders may need guidance.",
        basisKeys: ["missing"],
        extractionConfidence: "medium",
      },
    ]);
    expect(bad.kept).toHaveLength(0);
    expect(bad.dropped.unsupported).toBe(1);
  });
  it("needs two different read sources for a contradiction", () => {
    const base: VerifiableFinding = {
      key: "c1",
      kind: "contradiction",
      topic: "other",
      statement: "Sources disagree.",
      sourceFetchId: "f1",
      secondSourceFetchId: "f2",
      extractionConfidence: "medium",
    };
    expect(run([base]).kept).toHaveLength(1);
    expect(run([{ ...base, secondSourceFetchId: "f1" }]).kept).toHaveLength(0);
    expect(run([{ ...base, secondSourceFetchId: "f4" }]).dropped.uncited).toBe(1);
    expect(run([{ ...base, topic: "budget" }]).dropped.protectedTopic).toBe(1);
  });
  it("drops a type key outside the current taxonomy and counts it", () => {
    const r = run([fact({ typeKey: "not_in_taxonomy" })]);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped.taxonomy).toBe(1);
    expect(run([fact({ typeKey: undefined })]).kept).toHaveLength(1);
  });
  it("caps confidence at low when the page names neither the account nor a known domain", () => {
    const r = run([
      fact({
        key: "e1",
        sourceFetchId: "f3",
        supportingText: "mentions nothing about the account",
      }),
      fact({ key: "e2" }),
    ]);
    expect(r.kept.find((k) => k.key === "e1")!.confidence).toBe("low");
    expect(r.kept.find((k) => k.key === "e2")!.confidence).toBe("high");
    expect(r.entityMatch).toEqual({ f1: "high", f2: "high", f3: "low", f4: "low" });
  });
  it("drops a repeated key and is deterministic", () => {
    const findings = [fact(), fact({ statement: "Duplicate key." })];
    const r = run(findings);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped.unsupported).toBe(1);
    expect(run(findings)).toEqual(r);
  });
});
