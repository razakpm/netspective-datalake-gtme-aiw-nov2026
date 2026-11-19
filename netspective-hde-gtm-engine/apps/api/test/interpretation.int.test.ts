import { describe, expect, it } from "vitest";
import type { FakeRule } from "@gtm/providers";
import { ACCOUNTS, buildResearchHarness } from "../test-support/research-harness.js";

// Task T050: the Healthcare Data Problem Agent (quickstart V17).
const A = ACCOUNTS;
const STATEMENT =
  "Our pilot worked on demo data but failed on ours, and we do not know why it keeps stalling.";
const msg = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return "no error";
};
const rule = (respond: unknown): FakeRule => ({
  task: "interpretation",
  whenTextIncludes: ["pilot worked"],
  respond,
});

describe("problem interpretation", () => {
  it("returns advisory capability matches, discovery questions and unknowns with model and prompt version", async () => {
    const h = buildResearchHarness({ scenario: "riverbend" });
    const r = await h.interpreter.interpret(h.actor(), A.riverbend.id, {
      statement: "Our pilot worked on demo data but failed on ours, and we cannot tell why.",
    });
    expect(r).toMatchObject({
      label: "AI-generated, advisory",
      accountId: A.riverbend.id,
      modelAndPrompt: { model: "m-small", promptVersion: "problem-interpret@1.0.0" },
    });
    expect(r.matches.map((m) => [m.capabilityKey, m.band])).toEqual([
      ["field_lineage_traceability", "high"],
      ["data_quality_monitoring", "medium"],
    ]);
    expect(r.discoveryQuestions).toHaveLength(10);
    expect(r.unknowns).toEqual([
      "Who owns the data feeding the pilot.",
      "Who holds the budget for the pilot.",
    ]);
    expect(Number(r.cost)).toBeGreaterThan(0);
    expect(
      h.count(
        "confidence_assessment",
        "subject_type = 'interpretation' AND dimension = 'capability_match'",
      ),
    ).toBe(2);
    expect(h.count("audit_event", "action = 'interpretation.create'")).toBe(1);
  });
  it("stores only the statement's hash, never its text, and no decision field changes", async () => {
    const h = buildResearchHarness({ scenario: "riverbend" });
    const before = JSON.stringify([
      h.db.raw.prepare("SELECT * FROM account").all(),
      h.db.raw.prepare("SELECT * FROM account_hypothesis").all(),
      h.db.raw.prepare("SELECT * FROM signal").all(),
    ]);
    await h.interpreter.interpret(h.actor(), A.riverbend.id, {
      statement: "Our pilot worked on demo data but failed on ours, and we cannot tell why.",
    });
    const dump = ["problem_interpretation", "audit_event", "ai_invocation", "outbox_event"]
      .map((t) => JSON.stringify(h.db.raw.prepare(`SELECT * FROM ${t}`).all()))
      .join("");
    expect(dump).not.toContain("worked on demo data");
    const row = h.db.raw.prepare("SELECT statement_sha256 FROM problem_interpretation").get() as {
      statement_sha256: string;
    };
    expect(row.statement_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      JSON.stringify([
        h.db.raw.prepare("SELECT * FROM account").all(),
        h.db.raw.prepare("SELECT * FROM account_hypothesis").all(),
        h.db.raw.prepare("SELECT * FROM signal").all(),
      ]),
    ).toBe(before);
    expect(h.count("icp_fit_assessment")).toBe(0);
  });
  it("refuses a PHI-like statement before any model sees it, with rule ids only", async () => {
    const h = buildResearchHarness({ scenario: "riverbend" });
    const m = await msg(
      h.interpreter.interpret(h.actor(), A.riverbend.id, {
        statement: "Patient SSN 000-12-3456 appears in our failed pilot runs and we need help.",
      }),
    );
    expect(m).toContain("PHI");
    expect(m).not.toContain("000-12-3456");
    expect(h.llm.calls).toHaveLength(0);
    expect(h.count("problem_interpretation")).toBe(0);
    expect(h.count("audit_event", "action = 'interpretation.refused'")).toBe(1);
    expect(JSON.stringify(h.db.raw.prepare("SELECT * FROM audit_event").all())).not.toContain(
      "000-12-3456",
    );
  });
  it("drops matches to unknown capabilities and questions that ask for patient-level data, counting them", async () => {
    const h = buildResearchHarness({
      llmRules: [
        rule({
          matches: [
            { capabilityKey: "field_lineage_traceability", band: "high", reason: "Fits." },
            { capabilityKey: "invented_service", band: "high", reason: "Invented." },
          ],
          discoveryQuestions: [
            "Which fields does the pilot use?",
            "Can you send us the patient names that failed?",
            "Which source systems supply them?",
          ],
          unknowns: [],
        }),
      ],
    });
    const r = await h.interpreter.interpret(h.actor(), A.riverbend.id, { statement: STATEMENT });
    expect(r.matches.map((m) => m.capabilityKey)).toEqual(["field_lineage_traceability"]);
    expect(r.discoveryQuestions).toEqual([
      "Which fields does the pilot use?",
      "Which source systems supply them?",
    ]);
    const audit = h.db.raw
      .prepare("SELECT after_summary FROM audit_event WHERE action = 'interpretation.create'")
      .get() as { after_summary: string };
    expect(JSON.parse(audit.after_summary)).toMatchObject({
      dropped_matches: 1,
      dropped_questions: 1,
    });
  });
  it("retries invalid output, then fails with a typed error, recording the cost and no interpretation", async () => {
    const h = buildResearchHarness({
      llmRules: [
        { task: "interpretation", whenTextIncludes: [""], respondRaw: "nope", repeat: true },
      ],
    });
    expect(
      await msg(h.interpreter.interpret(h.actor(), A.riverbend.id, { statement: STATEMENT })),
    ).toContain("invalid_output");
    expect(
      h.count(
        "ai_invocation",
        "context_type = 'problem_interpretation' AND outcome = 'invalid_output'",
      ),
    ).toBe(3);
    expect(h.count("problem_interpretation")).toBe(0);
    expect(h.count("audit_event", "action = 'interpretation.refused'")).toBe(1);
  });
  it("refuses when the call could exceed the interpretation cap or the account allowance", async () => {
    const tight = buildResearchHarness({
      scenario: "riverbend",
      settings: { interpretationCapMicros: 100 },
    });
    expect(
      await msg(
        tight.interpreter.interpret(tight.actor(), A.riverbend.id, { statement: STATEMENT }),
      ),
    ).toContain("budget_refused");
    expect(tight.llm.calls).toHaveLength(0);
    const capped = buildResearchHarness({
      scenario: "riverbend",
      settings: { accountMonthlyCapMicros: 100 },
    });
    expect(
      await msg(
        capped.interpreter.interpret(capped.actor(), A.riverbend.id, { statement: STATEMENT }),
      ),
    ).toContain("budget_refused");
  });
  it("needs a person, a valid length, a known account and a signal of that account", async () => {
    const h = buildResearchHarness({ scenario: "riverbend" });
    expect(
      await msg(
        h.interpreter.interpret(
          { userId: null, actorType: "ai", correlationId: null },
          A.riverbend.id,
          { statement: STATEMENT },
        ),
      ),
    ).toContain("Only a person");
    expect(
      await msg(h.interpreter.interpret(h.actor(), A.riverbend.id, { statement: "too short" })),
    ).toContain("statement_length");
    expect(
      await msg(h.interpreter.interpret(h.actor(), "missing", { statement: STATEMENT })),
    ).toContain("unknown_account");
    const other = h.signal(A.lakeshore.id, "A different account's observation.");
    expect(
      await msg(
        h.interpreter.interpret(h.actor(), A.riverbend.id, {
          statement: STATEMENT,
          sourceSignalId: other.id,
        }),
      ),
    ).toContain("unknown_source_signal");
  });
  it("can be attached to a hypothesis only as an assumption, never as a confirmed fact", async () => {
    const h = buildResearchHarness({ scenario: "riverbend" });
    const sig = h.signal(A.riverbend.id, "The pilot worked on demo data and failed on ours.", {
      source: { sourceId: "default-source-buyer_statement", ref: "call-1" },
      evidenceStatus: "buyer_confirmed",
    });
    const interp = await h.interpreter.interpret(h.actor(), A.riverbend.id, {
      statement: STATEMENT,
      sourceSignalId: sig.id,
    });
    const hyp = h.hypotheses.create(h.actor(), A.riverbend.id, {
      statement: "The stalled pilot may be failing because its inputs cannot be traced.",
      category: "pilot_input_quality",
      supportingSignalIds: [sig.id],
      confidence: { band: "medium", explanation: "The buyer says it failed on real data." },
    });
    const updated = h.hypotheses.addAssumption(
      h.actor(),
      hyp.id,
      "The pilot depends on a small set of named fields.",
      interp.id,
    );
    expect(updated.assumptions.at(-1)).toMatchObject({
      source: "interpretation",
      interpretationId: interp.id,
    });
    expect(updated.buyerConfirmedFacts.map((f) => f.signalId)).toEqual([sig.id]);
    expect(updated.status).toBe("untested");
  });
});
