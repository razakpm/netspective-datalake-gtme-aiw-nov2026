import { beforeEach, describe, expect, it } from "vitest";
import { ACCOUNTS, buildResearchHarness, type Harness } from "../test-support/research-harness.js";

// Task T042: creating, accepting, editing and linking hypotheses (quickstart V12, V13, V19).
const A = ACCOUNTS;
let h: Harness;
const analyst = () => h.actor();
const msg = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "no error";
};
beforeEach(() => {
  h = buildResearchHarness();
});
const input = (signalIds: string[], over: Record<string, unknown> = {}) => ({
  statement: "Sender onboarding delays after implementation-guide changes may be slowing intake.",
  category: "onboarding_friction",
  relevance: {
    icp: ["icp1"],
    capability: ["sender_onboarding_automation"],
    offer: ["sender_friction_map"],
  },
  supportingSignalIds: signalIds,
  assumptions: ["Senders keep submitting in more than one format."],
  confidence: {
    band: "medium" as const,
    explanation: "Two public observations agree; no buyer confirmation yet.",
  },
  ...over,
});

describe("creating a hypothesis", () => {
  it("saves it untested with supporting and contradictory lists, assumptions apart, bands and definitions", () => {
    const s1 = h.signal(A.northvale.id, "Senders report onboarding delays.");
    const s2 = h.signal(A.northvale.id, "Another source reports fast onboarding.");
    const created = h.hypotheses.create(
      analyst(),
      A.northvale.id,
      input([s1.id], { contradictorySignalIds: [s2.id] }),
    );
    expect(created).toMatchObject({
      acceptance: "accepted",
      origin: "analyst",
      status: "untested",
      effectiveStatus: "untested",
      category: "onboarding_friction",
      notForPrioritisation: false,
      label: "",
      flaggedForReview: false,
    });
    expect(created.confidence).toEqual({
      band: "medium",
      explanation: "Two public observations agree; no buyer confirmation yet.",
    });
    expect(created.supporting.map((x) => x.signalId)).toEqual([s1.id]);
    expect(created.contradictory.map((x) => x.signalId)).toEqual([s2.id]);
    expect(created.supporting[0]).toMatchObject({
      evidenceStatus: "observed",
      reviewStatus: "pending",
      isCurrent: false,
    });
    expect(created.buyerConfirmedFacts).toEqual([]);
    expect(created.assumptions).toEqual([
      {
        text: "Senders keep submitting in more than one format.",
        source: "analyst",
        interpretationId: null,
      },
    ]);
    expect(created.relevance).toEqual({
      icp: ["icp1"],
      capability: ["sender_onboarding_automation"],
      offer: ["sender_friction_map"],
    });
    expect(created.definitions.high).toMatch(/hypothesis until a buyer confirms/);
    expect(JSON.stringify(created)).not.toMatch(/"score"|percent/);
    expect(h.db.raw.prepare("SELECT created_by FROM account_hypothesis").get()).toEqual({
      created_by: "analyst-1",
    });
  });
  it("shows buyer-confirmed facts apart from assumptions and inferences", () => {
    const bc = h.signal(A.riverbend.id, "The pilot worked on demo data and failed on ours.", {
      source: { sourceId: "default-source-buyer_statement", ref: "call-2026-11-10" },
      evidenceStatus: "buyer_confirmed",
    });
    const created = h.hypotheses.create(
      analyst(),
      A.riverbend.id,
      input([bc.id], { category: "pilot_input_quality", relevance: { icp: ["icp2"] } }),
    );
    expect(created.buyerConfirmedFacts.map((x) => x.signalId)).toEqual([bc.id]);
    expect(created.assumptions.every((a) => a.source === "analyst")).toBe(true);
  });
  it("refuses a conclusion-like statement, no supporting signal, an unknown category, tag, signal or another account's signal, and PHI-like text", () => {
    const s = h.signal(A.northvale.id, "Senders report onboarding delays.");
    const other = h.signal(A.lakeshore.id, "A different account's observation.");
    const cases: [Record<string, unknown>, string][] = [
      [{ statement: "The funding path is confirmed for this programme." }, "asserts_funding_path"],
      [{ statement: "This organisation is qualified for a sprint." }, "asserts_qualification"],
      [{ supportingSignalIds: [] }, "supporting_signal_required"],
      [{ category: "nonsense" }, "unknown_category"],
      [{ relevance: { capability: ["not_a_capability"] } }, "invalid_tag:capability"],
      [{ relevance: { icp: ["icp9"] } }, "invalid_tag:icp"],
      [{ supportingSignalIds: ["missing-signal"] }, "unknown_signal"],
      [{ supportingSignalIds: [other.id] }, "signal_of_another_account"],
      [{ contradictorySignalIds: [s.id] }, "signal_both_supporting_and_contradictory"],
      [{ confidence: { band: "low", explanation: "ab" } }, "explanation_required"],
    ];
    for (const [over, code] of cases)
      expect(
        msg(() => h.hypotheses.create(analyst(), A.northvale.id, input([s.id], over))),
        code,
      ).toContain(code);
    const phi = msg(() =>
      h.hypotheses.create(
        analyst(),
        A.northvale.id,
        input([s.id], { assumptions: ["Patient SSN 000-12-3456 on file."] }),
      ),
    );
    expect(phi).toContain("PHI");
    expect(phi).not.toContain("000-12-3456");
    expect(h.count("account_hypothesis")).toBe(0);
    expect(h.count("audit_event", "action = 'hypothesis.create.refused'")).toBeGreaterThanOrEqual(
      10,
    );
  });
  it("refuses AI and system actors", () => {
    const s = h.signal(A.northvale.id, "Senders report onboarding delays.");
    for (const actorType of ["ai", "system"] as const) {
      expect(
        msg(() =>
          h.hypotheses.create(
            { userId: null, actorType, correlationId: null },
            A.northvale.id,
            input([s.id]),
          ),
        ),
      ).toContain("must_be_human");
    }
  });
  it("marks a hypothesis on an excluded account not for prioritisation and emits identifiers-only events", () => {
    const s = h.signal(A.helixbio.id, "Helixbio announced a new programme.", {
      typeKey: "program_announcement",
    });
    const created = h.hypotheses.create(analyst(), A.helixbio.id, input([s.id]));
    expect(created.notForPrioritisation).toBe(true);
    const events = h.db.raw
      .prepare("SELECT type, payload FROM outbox_event WHERE type = 'hypothesis.created'")
      .all() as { type: string; payload: string }[];
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.payload)).toEqual({
      hypothesis_id: created.id,
      account_id: A.helixbio.id,
      origin: "analyst",
    });
    expect(JSON.stringify(h.db.raw.prepare("SELECT * FROM audit_event").all())).not.toContain(
      "programme",
    );
  });
  it("records the hypothesis against the survivor account", () => {
    h.db.raw
      .prepare("UPDATE account SET merged_into = ? WHERE id = ?")
      .run(A.northvale.id, A.granite.id);
    const s = h.signal(A.northvale.id, "Senders report onboarding delays.");
    expect(h.hypotheses.create(analyst(), A.granite.id, input([s.id])).accountId).toBe(
      A.northvale.id,
    );
  });
});

describe("evidence, assumptions and edits", () => {
  it("links signals once, never removes a link, and keeps the lists append-only", () => {
    const s1 = h.signal(A.northvale.id, "Senders report onboarding delays.");
    const s2 = h.signal(A.northvale.id, "Implementation guide changed in October.", {
      typeKey: "implementation_guide_change",
    });
    const hyp = h.hypotheses.create(analyst(), A.northvale.id, input([s1.id]));
    const linked = h.hypotheses.link(analyst(), hyp.id, s2.id, "supporting");
    expect(linked.supporting.map((x) => x.signalId)).toEqual([s1.id, s2.id]);
    expect(msg(() => h.hypotheses.link(analyst(), hyp.id, s2.id, "contradictory"))).toContain(
      "already_linked",
    );
    expect(() => h.db.raw.prepare("DELETE FROM hypothesis_evidence").run()).toThrow();
    expect(h.count("outbox_event", "type = 'hypothesis.updated'")).toBe(1);
  });
  it("adds assumptions and an interpretation-sourced assumption, never as a confirmed fact", () => {
    const s = h.signal(A.riverbend.id, "The pilot failed on real data.");
    const hyp = h.hypotheses.create(
      analyst(),
      A.riverbend.id,
      input([s.id], { category: "pilot_input_quality", relevance: { icp: ["icp2"] } }),
    );
    h.db.raw
      .prepare(
        "INSERT INTO problem_interpretation (id, account_id, statement_sha256, matches_json, questions_json, unknowns_json, ai_model, ai_prompt_version_id, requested_by, created_at) VALUES ('pi1', ?, 'h','[]','[]','[]','m','prompt-problem-interpret-1.0.0','u','2026-11-19')",
      )
      .run(A.riverbend.id);
    const updated = h.hypotheses.addAssumption(
      analyst(),
      hyp.id,
      "The pilot depends on a small set of named fields.",
      "pi1",
    );
    expect(updated.assumptions.at(-1)).toEqual({
      text: "The pilot depends on a small set of named fields.",
      source: "interpretation",
      interpretationId: "pi1",
    });
    expect(updated.buyerConfirmedFacts).toEqual([]);
    expect(msg(() => h.hypotheses.addAssumption(analyst(), hyp.id, "text", "missing"))).toContain(
      "unknown_interpretation",
    );
    expect(
      msg(() => h.hypotheses.addAssumption(analyst(), hyp.id, "Patient SSN 000-12-3456")),
    ).toContain("PHI");
  });
  it("edits text and confidence with an audit, keeping the AI's original wording for proposals", () => {
    const s = h.signal(A.northvale.id, "Senders report onboarding delays.");
    const hyp = h.hypotheses.create(analyst(), A.northvale.id, input([s.id]));
    const edited = h.hypotheses.edit(analyst(), hyp.id, {
      statement: "Sender onboarding may be slow after guide changes in some formats.",
      confidence: { band: "high", explanation: "More sources agree now." },
    });
    expect(edited.statement).toContain("some formats");
    expect(edited.confidence.band).toBe("high");
    expect(
      msg(() =>
        h.hypotheses.edit(analyst(), hyp.id, {
          statement: "The budget has been approved already.",
        }),
      ),
    ).toContain("asserts_budget_approval");
    expect(h.count("audit_event", "action = 'hypothesis.edit'")).toBe(1);
  });
});

describe("listing", () => {
  it("lists accepted hypotheses by default, proposals only on request, paged newest first", () => {
    const s = h.signal(A.northvale.id, "Senders report onboarding delays.");
    const a = h.hypotheses.create(analyst(), A.northvale.id, input([s.id]));
    const b = h.hypotheses.create(
      analyst(),
      A.northvale.id,
      input([s.id], { statement: "A second testable statement about intake delays." }),
    );
    expect(h.hypotheses.list(A.northvale.id, {}).items.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(h.hypotheses.list(A.northvale.id, { acceptance: "proposed" }).items).toEqual([]);
    const page = h.hypotheses.list(A.northvale.id, { limit: 1 });
    expect(page.nextCursor).toBe(b.id);
    expect(
      h.hypotheses.list(A.northvale.id, { cursor: page.nextCursor! }).items.map((x) => x.id),
    ).toEqual([a.id]);
    expect(msg(() => h.hypotheses.list("missing", {}))).toContain("unknown_account");
  });
});
