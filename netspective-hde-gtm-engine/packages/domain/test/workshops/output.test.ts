import { describe, expect, it } from "vitest";
import {
  buildOutputSections,
  FINDINGS_DISCLAIMER,
  generatedSectionsOf,
  outputProblems,
  outputTextLength,
  renderOutputHtml,
  type Offer1Findings,
  type Offer6Findings,
  type OutputSections,
} from "../../src/index.js";
import { caseById, corpus } from "./findings-cases.js";

// Feature 007 task T053 (spec FR-030 to FR-032, research R-12): the page is built from finalised findings
// only, never words an unknown as a gap or an unconfirmed delay as confirmed, and is gated.
const one = () => caseById(corpus.offer1, "offer1-complete").content as unknown as Offer1Findings;
const six = () => caseById(corpus.offer6, "offer6-complete").content as unknown as Offer6Findings;
const facts = { organisation: "Northvale HIE", offerName: "Friction Map", date: "2026-11-24" };
const build1 = (content = one(), waiverReason: string | null = null) =>
  buildOutputSections({ kind: "offer_1", content, waiverReason, ...facts });
const build6 = (content = six(), waiverReason: string | null = null) =>
  buildOutputSections({ kind: "offer_6", content, waiverReason, ...facts });
const codes = (sections: OutputSections, generated: OutputSections, maxChars = 3500) =>
  outputProblems(sections, { generated, maxChars }).map((p) => p.code);

describe("the draft", () => {
  it("is built from the Offer 1 findings", () => {
    const s = build1();
    expect(s).toMatchObject({
      title: "Friction Map: workshop findings",
      organisation: "Northvale HIE",
      offerName: "Friction Map",
      date: "2026-11-24",
      summary: one().flowSummary,
      nextStep: one().suggestedNextStep,
      boundaryNote: one().boundaryNote,
    });
    for (const d of one().delaySources) expect(s.findings).toContain(d.description);
    expect(s.findings).toContain("2 weeks");
    expect(s.findings).toContain("not quantified");
    expect(s.unknowns).toContain(one().unknowns[0]);
    expect(s.inScope.length).toBeGreaterThan(0);
    expect(s.outOfScope.join(" ")).toContain("paid work");
    expect(s.disclaimer).toBeUndefined();
  });
  it("words each confirmation as it was recorded", () => {
    const c = one();
    c.delaySources[0]!.confirmation = "confirmed";
    c.delaySources[1]!.confirmation = "not_confirmed";
    c.delaySources[2]!.confirmation = "unknown";
    const lines = build1(c).findings.split("\n");
    expect(lines[0]).toMatch(/\(confirmed by the buyer\)/);
    expect(lines[1]).toMatch(/\(not confirmed\)/);
    expect(lines[2]).toMatch(/\(confirmation unknown\)/);
    expect(build1(c).findings.match(/confirmed by the buyer/g)).toHaveLength(1);
  });
  it("is built from the Offer 6 findings, with the fixed disclaimer", () => {
    const s = build6();
    expect(s.disclaimer).toBe(FINDINGS_DISCLAIMER);
    expect(s.findings).toContain("Overall view: conditional");
    expect(s.nextStep).toContain(six().inputAuditScope.useCase);
    expect(s.nextStep).toContain(six().inputAuditScope.sources[0]);
    expect(s.summary).toBe(six().overall.reason);
  });
  it("keeps unknown and not recorded apart from gaps, and never words them as one", () => {
    const c = six();
    c.fields[0]!.observations.quality.status = "unknown";
    c.fields[1]!.observations.access.status = null;
    const s = build6(c);
    expect(s.unknowns).toContain(`Unknown: ${c.fields[0]!.name} (quality)`);
    expect(s.unknowns).toContain(`Not recorded: ${c.fields[1]!.name} (access)`);
    expect(s.unknowns).not.toMatch(/gap|fail/i);
    const gapLines = s.findings.split("\n").filter((line) => /gap/i.test(line));
    for (const line of gapLines) {
      expect(line).not.toContain(`${c.fields[0]!.name} (quality`);
      expect(line).not.toMatch(/unknown|not recorded|fail/i);
    }
    // Nothing unknown or unrecorded changes the count of gaps to include it.
    expect(s.findings).toContain("known good");
  });
  it("states a waived shortfall", () => {
    const c = one();
    c.delaySources.pop();
    expect(build1(c, "Only two sources came up").findings).toContain(
      "Finalised with a recorded shortfall: Only two sources came up",
    );
  });
  it("keeps long generated text inside its limits and says what was left out", () => {
    const c = six();
    for (const field of c.fields) {
      for (const o of Object.values(field.observations)) o.status = "unknown";
    }
    const s = build6(c);
    expect(s.unknowns.length).toBeLessThanOrEqual(600);
    expect(s.unknowns).toMatch(/and \d+ more/);
    const long = one();
    for (const d of long.delaySources) d.description = "x".repeat(300);
    expect(build1(long).findings.length).toBeLessThanOrEqual(1200);
  });
});

describe("the gates", () => {
  const generated = build1();
  it("passes a fresh draft", () => {
    expect(codes(generated, generated)).toEqual([]);
    expect(codes(build6(), build6())).toEqual([]);
  });
  it("needs both scope sections", () => {
    expect(codes({ ...generated, inScope: [] }, generated)).toEqual(["scope_section_missing"]);
    expect(codes({ ...generated, outOfScope: [" "] }, generated)).toEqual([
      "scope_section_missing",
    ]);
  });
  it("needs the unchanged Offer 6 disclaimer", () => {
    const g = build6();
    expect(codes({ ...g, disclaimer: undefined }, g)).toContain("disclaimer_missing");
    expect(codes({ ...g, disclaimer: "No warranty." }, g)).toContain("disclaimer_missing");
  });
  it("fits one page", () => {
    expect(codes(generated, generated, outputTextLength(generated) - 1)).toEqual(["over_one_page"]);
    expect(codes(generated, generated, outputTextLength(generated))).toEqual([]);
  });
  it("states no price", () => {
    expect(codes({ ...generated, summary: "It costs $500." }, generated)).toEqual(["price_stated"]);
    expect(codes({ ...generated, inScope: ["A fee applies"] }, generated)).toEqual([
      "price_stated",
    ]);
  });
  it("keeps the generated sections as the findings made them", () => {
    for (const change of [
      { findings: "All confirmed." },
      { unknowns: "" },
      { boundaryNote: "Free fixes included." },
      { organisation: "Someone else" },
    ]) {
      expect(codes({ ...generated, ...change }, generated)).toEqual(["generated_section_changed"]);
    }
    expect(Object.keys(generatedSectionsOf(generated)).sort()).toEqual([
      "boundaryNote",
      "date",
      "findings",
      "offerName",
      "organisation",
      "unknowns",
    ]);
  });
  it("says every problem in plain words", () => {
    for (const p of outputProblems({ ...generated, inScope: [] }, { generated, maxChars: 1 })) {
      expect(p.message).not.toContain("_");
    }
  });
});

describe("the page", () => {
  it("escapes every text and pulls in nothing", () => {
    const s = {
      ...build6(),
      title: `<script>alert("x")</script>`,
      summary: "A & B <img src=https://evil.example/x.png>",
      inScope: ["<a href='https://evil.example'>x</a>"],
    };
    const html = renderOutputHtml(s);
    expect(html).not.toMatch(/<script|<img|<a |<link|<iframe/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
    // No real element carries an address; the same words inside escaped text are only text.
    expect(html).not.toMatch(/<[^>]*\s(src|href)\s*=/i);
    expect(html).toContain("In scope");
    expect(html).toContain("Out of scope");
    expect(html).toContain("not a guarantee");
  });
});
