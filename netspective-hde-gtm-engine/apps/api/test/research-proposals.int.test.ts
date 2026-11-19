import { describe, expect, it } from "vitest";
import type { FakeRule } from "@gtm/providers";
import { ACCOUNTS, buildResearchHarness } from "../test-support/research-harness.js";

// Task T044: AI hypothesis proposals from a run. Proposals are not hypotheses until an analyst accepts.
const A = ACCOUNTS;
const SENDERS = "https://news.northvale-hie.example/senders";
const IG = "https://docs.northvale-hie.example/ig-update";
const rows = (h: ReturnType<typeof buildResearchHarness>) =>
  h.db.raw.prepare("SELECT * FROM account_hypothesis ORDER BY rowid").all() as Record<
    string,
    unknown
  >[];

describe("hypothesis proposals", () => {
  it("stores the AI's proposal as a proposal with its provenance, supporting signals, tags and assumptions, and no status", async () => {
    const h = buildResearchHarness({ scenario: "northvale", withProposals: true });
    const run = await h.runFor(A.northvale.id, [SENDERS, IG]);
    expect(run.state).toBe("completed");
    const [p] = rows(h);
    expect(p).toMatchObject({
      origin: "ai",
      acceptance: "proposed",
      status: null,
      category: "onboarding_friction",
      ai_model: "m-large",
      proposed_by_run_id: run.id,
      confidence_band: "medium",
      not_for_prioritisation: 0,
    });
    expect(p!["proposed_statement"]).toBe(p!["statement"]);
    expect(h.count("hypothesis_evidence", "role = 'supporting' AND linked_by_type = 'ai'")).toBe(2);
    expect(
      h.count(
        "hypothesis_tag",
        "dimension = 'capability' AND value = 'sender_onboarding_automation'",
      ),
    ).toBe(1);
    expect(h.count("hypothesis_assumption", "source = 'ai'")).toBe(1);
    expect(h.count("ai_invocation", "task = 'synthesis'")).toBe(1);
    expect(h.count("audit_event", "action = 'hypothesis.propose'")).toBe(1);
    expect(h.count("outbox_event", "type = 'hypothesis.created'")).toBe(0);
  });
  it("keeps proposals out of the default list, labels them, and becomes untested only when an analyst accepts", async () => {
    const h = buildResearchHarness({ scenario: "northvale", withProposals: true });
    await h.runFor(A.northvale.id, [SENDERS, IG]);
    expect(h.hypotheses.list(A.northvale.id, {}).items).toEqual([]);
    const proposals = h.hypotheses.list(A.northvale.id, { acceptance: "proposed" }).items;
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      status: null,
      effectiveStatus: null,
      label: "AI-proposed, not accepted",
    });
    const id = proposals[0]!.id;
    const accepted = h.hypotheses.accept(h.actor(), id);
    expect(accepted).toMatchObject({ acceptance: "accepted", status: "untested", label: "" });
    expect(h.hypotheses.list(A.northvale.id, {}).items.map((x) => x.id)).toEqual([id]);
    expect(h.count("outbox_event", "type = 'hypothesis.created'")).toBe(1);
    expect(() => h.hypotheses.accept(h.actor(), id)).toThrow(/not_a_proposal/);
    expect(() =>
      h.hypotheses.accept({ userId: null, actorType: "ai", correlationId: null }, id),
    ).toThrow(/must_be_human/);
  });
  it("lets an analyst dismiss a proposal, finally", async () => {
    const h = buildResearchHarness({ scenario: "northvale", withProposals: true });
    await h.runFor(A.northvale.id, [SENDERS, IG]);
    const id = h.hypotheses.list(A.northvale.id, { acceptance: "proposed" }).items[0]!.id;
    expect(h.hypotheses.dismiss(h.actor(), id).acceptance).toBe("dismissed");
    expect(() => h.hypotheses.accept(h.actor(), id)).toThrow(/not_a_proposal/);
    expect(() =>
      h.hypotheses.edit(h.actor(), id, { statement: "A new testable statement about intake." }),
    ).toThrow(/dismissed/);
  });
  it("drops proposals that assert a qualification fact, rest on no signal of this run, or use an unknown category", async () => {
    const extract: FakeRule = {
      task: "extraction",
      whenTextIncludes: ["Northvale HIE"],
      respond: {
        findings: [
          {
            key: "n1",
            kind: "fact",
            topic: "other",
            statement: "Senders submit data in three formats.",
            supportingText: "three formats: CCDA, HL7 v2 and CSV extracts",
            sourceFetchId: "$BLOCK:1",
            typeKey: "multi_format_sender",
            extractionConfidence: "high",
          },
        ],
      },
    };
    const good = {
      statement: "Multiple formats may be complicating sender onboarding.",
      category: "onboarding_friction",
      relevance: { icp: ["icp1"], capability: ["not_a_capability"], offer: ["Bad Offer"] },
      supportingFindingKeys: ["n1"],
      contradictoryFindingKeys: [],
      assumptions: [],
      confidence: { band: "low", explanation: "One observation only." },
    };
    const synth: FakeRule = {
      task: "synthesis",
      whenTextIncludes: ["three formats"],
      respond: {
        proposals: [
          { ...good, statement: "The funding path is confirmed for this programme." },
          { ...good, supportingFindingKeys: ["zz"] },
          { ...good, category: "unknown_category" },
          good,
        ],
      },
    };
    const h = buildResearchHarness({ llmRules: [extract, synth], withProposals: true });
    await h.runFor(A.northvale.id, [SENDERS]);
    const stored = rows(h);
    expect(stored).toHaveLength(1);
    expect(stored[0]!["statement"]).toBe(good.statement);
    expect(h.count("hypothesis_tag", "dimension = 'capability'")).toBe(0);
    expect(h.count("hypothesis_tag", "dimension = 'offer'")).toBe(0);
    const audit = h.db.raw
      .prepare("SELECT after_summary FROM audit_event WHERE action = 'hypothesis.propose'")
      .get() as { after_summary: string };
    expect(JSON.parse(audit.after_summary)).toEqual({ proposed: 1, dropped: 3 });
  });
  it("counts the proposal call in the run's cost, and a failed proposal call never undoes the summary", async () => {
    const extract: FakeRule = {
      task: "extraction",
      whenTextIncludes: ["Northvale HIE"],
      respond: {
        findings: [
          {
            key: "n1",
            kind: "fact",
            topic: "other",
            statement: "Senders submit data in three formats.",
            supportingText: "three formats: CCDA, HL7 v2 and CSV extracts",
            sourceFetchId: "$BLOCK:1",
            typeKey: "multi_format_sender",
            extractionConfidence: "high",
          },
        ],
      },
    };
    const h = buildResearchHarness({
      llmRules: [
        extract,
        { task: "synthesis", whenTextIncludes: [""], respondRaw: "not json", repeat: true },
      ],
      withProposals: true,
    });
    const run = await h.runFor(A.northvale.id, [SENDERS]);
    expect(run.state).toBe("completed");
    expect(rows(h)).toEqual([]);
    expect(h.count("ai_invocation", "task = 'synthesis' AND outcome = 'invalid_output'")).toBe(3);
    expect(run.totals.retries).toBe(2);
    expect(
      h.db.raw.prepare("SELECT summary_json FROM research_run WHERE id = ?").get(run.id),
    ).not.toEqual({ summary_json: null });
  });
  it("marks a proposal on an excluded account not for prioritisation", async () => {
    const extract: FakeRule = {
      task: "extraction",
      whenTextIncludes: ["Helixbio"],
      respond: {
        findings: [
          {
            key: "h1",
            kind: "fact",
            topic: "other",
            statement: "Helixbio announced a programme.",
            supportingText: "Helixbio announced",
            sourceFetchId: "$BLOCK:1",
            typeKey: "program_announcement",
            extractionConfidence: "high",
          },
        ],
      },
    };
    const synth: FakeRule = {
      task: "synthesis",
      whenTextIncludes: ["announced a programme"],
      respond: {
        proposals: [
          {
            statement: "Helixbio may have a data intake need.",
            category: "other",
            relevance: { icp: [], capability: [], offer: [] },
            supportingFindingKeys: ["h1"],
            contradictoryFindingKeys: [],
            assumptions: [],
            confidence: { band: "low", explanation: "One announcement." },
          },
        ],
      },
    };
    const h = buildResearchHarness({
      llmRules: [extract, synth],
      withProposals: true,
      pages: [
        {
          address: "https://www.helixbio.example/news",
          status: 200,
          contentType: "text/html",
          text: "Helixbio announced a new programme today.",
        },
      ],
    });
    const run = await h.runFor(A.helixbio.id, ["https://www.helixbio.example/news"]);
    expect(run.icpExcluded).toBe(true);
    expect(rows(h)[0]!["not_for_prioritisation"]).toBe(1);
  });
});
