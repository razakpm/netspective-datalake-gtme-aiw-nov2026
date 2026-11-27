import { describe, expect, it } from "vitest";
import {
  baselineBrief,
  verifyBrief,
  type BriefEvidence,
  type BriefModelAnswer,
} from "../../src/index.js";

// Feature 007 task T049 (spec FR-010 to FR-013, research R-08; constitution I and II): a confirmed fact is
// always the evidence record's own text, and contradicting evidence is always listed.
const ev = (
  id: string,
  status: BriefEvidence["status"],
  text: string,
  topic = "sender_onboarding_friction",
): BriefEvidence => ({ id, status, text, topic });
const EVIDENCE = [
  ev("e-seen", "observed", "Repeated onboarding delays were recorded."),
  ev(
    "e-buyer",
    "buyer_confirmed",
    "The buyer confirmed guide changes cause rework.",
    "ig_change_friction",
  ),
  ev("e-derived", "derived_interpretation", "Review may be the bottleneck."),
  ev("e-ai", "ai_hypothesis", "Testing may be slow."),
  ev("e-assumed", "unverified_assumption", "Senders may lack staff."),
  ev("e-against", "contradictory", "One sender onboarded quickly."),
];
const base = {
  workshopId: "w1",
  accountId: "a1",
  kind: "offer_1" as const,
  evidence: EVIDENCE,
  artifactKinds: ["specification", "timeline", "scrubbed_rejection_log", "field_list"],
};
const answer = (over: Partial<BriefModelAnswer> = {}): BriefModelAnswer => ({
  entityIds: { workshopId: "w1", accountId: "a1" },
  confirmedFactIds: ["e-seen"],
  inferences: [
    {
      statement: "Rejection review may cause delay.",
      evidenceIds: ["e-derived", "unknown-id"],
      contradictingEvidenceIds: ["e-against", "unknown-id"],
      basis: "One interpretation.",
    },
  ],
  unknowns: ["How long review takes."],
  suggestedQuestions: ["Who reviews rejections?"],
  artifactChecklist: [{ kind: "timeline", why: "To see the stages." }],
  ...over,
});

describe("the baseline brief", () => {
  const brief = baselineBrief(base);
  it("shows observed and buyer-confirmed records as facts, in their own words", () => {
    expect(brief.confirmedFacts).toEqual([
      { evidenceId: "e-seen", text: "Repeated onboarding delays were recorded." },
      { evidenceId: "e-buyer", text: "The buyer confirmed guide changes cause rework." },
    ]);
  });
  it("keeps interpretations, hypotheses and assumptions as inferences that cite them", () => {
    expect(brief.inferences.map((i) => i.evidenceIds)).toEqual([
      ["e-derived"],
      ["e-ai"],
      ["e-assumed"],
    ]);
    expect(brief.inferences[0]!.contradictingEvidenceIds).toEqual(["e-against"]);
    expect(brief.inferences[0]!.basis).toContain("not as an observation");
  });
  it("always lists contradicting evidence", () => {
    expect(brief.contradictions).toEqual([
      { evidenceId: "e-against", text: "One sender onboarded quickly." },
    ]);
  });
  it("lists what is not known, the fixed questions and only configured artifact kinds", () => {
    expect(brief.suggestedQuestions.length).toBeGreaterThan(3);
    expect(brief.suggestedQuestions.length).toBeLessThanOrEqual(12);
    expect(brief.artifactChecklist.map((a) => a.kind)).toEqual([
      "specification",
      "timeline",
      "scrubbed_rejection_log",
    ]);
    expect(
      baselineBrief({ ...base, artifactKinds: ["timeline"] }).artifactChecklist.map((a) => a.kind),
    ).toEqual(["timeline"]);
    const empty = baselineBrief({ ...base, evidence: [] });
    expect(empty.confirmedFacts).toEqual([]);
    expect(empty.inferences).toEqual([]);
    expect(empty.unknowns.join(" ")).toContain("No observed or buyer-confirmed evidence");
    expect(empty.unknowns.length).toBeGreaterThan(1);
  });
  it("has its own questions for Offer 6 and is deterministic", () => {
    const six = baselineBrief({ ...base, kind: "offer_6" });
    expect(six.suggestedQuestions).not.toEqual(brief.suggestedQuestions);
    expect(six.suggestedQuestions.length).toBeLessThanOrEqual(12);
    expect(baselineBrief(base)).toEqual(brief);
  });
});

describe("verifying a model's brief", () => {
  const verified = (over: Partial<BriefModelAnswer> = {}) => {
    const out = verifyBrief(answer(over), base);
    if (!out.ok) throw new Error("refused");
    return out.content;
  };
  it("builds confirmed facts only from the evidence text of confirming records", () => {
    const content = verified({
      confirmedFactIds: ["e-seen", "e-derived", "e-ai", "e-against", "invented", "e-seen"],
    });
    expect(content.confirmedFacts).toEqual([
      { evidenceId: "e-seen", text: "Repeated onboarding delays were recorded." },
    ]);
  });
  it("keeps only valid citations and drops an inference with none", () => {
    const content = verified({
      inferences: [
        ...answer().inferences,
        {
          statement: "Nothing supports this.",
          evidenceIds: ["invented"],
          contradictingEvidenceIds: [],
          basis: "none",
        },
      ],
    });
    expect(content.inferences).toEqual([
      {
        statement: "Rejection review may cause delay.",
        evidenceIds: ["e-derived"],
        contradictingEvidenceIds: ["e-against"],
        basis: "One interpretation.",
      },
    ]);
  });
  it("lists contradictions whatever the model said", () => {
    expect(verified({ inferences: [] }).contradictions).toEqual(baselineBrief(base).contradictions);
  });
  it("drops an artifact kind that is not configured", () => {
    expect(
      verified({
        artifactChecklist: [
          { kind: "timeline", why: "x" },
          { kind: "patient_extract", why: "x" },
        ],
      }).artifactChecklist,
    ).toEqual([{ kind: "timeline", why: "x" }]);
  });
  it("refuses an answer about another workshop or account", () => {
    for (const entityIds of [
      { workshopId: "w2", accountId: "a1" },
      { workshopId: "w1", accountId: "a2" },
    ]) {
      expect(verifyBrief(answer({ entityIds }), base)).toEqual({ ok: false });
    }
  });
});
