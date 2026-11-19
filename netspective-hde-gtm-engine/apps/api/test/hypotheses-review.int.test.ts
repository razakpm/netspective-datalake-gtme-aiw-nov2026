import { beforeEach, describe, expect, it } from "vitest";
import { ACCOUNTS, buildResearchHarness, type Harness } from "../test-support/research-harness.js";

// Task T045: reviewer-only status changes (quickstart V14, V15).
const A = ACCOUNTS;
let h: Harness;
const reviewer = () => h.reviewer();
const analyst = () => h.actor();
const msg = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "no error";
};
const make = (signalIds: string[]) =>
  h.hypotheses.create(analyst(), A.riverbend.id, {
    statement:
      "The stalled pilot may be failing because its inputs cannot be traced field by field.",
    category: "pilot_input_quality",
    supportingSignalIds: signalIds,
    confidence: { band: "medium", explanation: "The buyer says it failed on real data." },
  }).id;
const buyer = () =>
  h.signal(A.riverbend.id, "The pilot worked on demo data and failed on ours.", {
    source: { sourceId: "default-source-buyer_statement", ref: "call-2026-11-10" },
    evidenceStatus: "buyer_confirmed",
  });
beforeEach(() => {
  h = buildResearchHarness();
});

describe("status changes", () => {
  it("records each allowed change with who, when and the note, and keeps earlier decisions", () => {
    const id = make([h.signal(A.riverbend.id, "Public note about a stalled pilot.").id]);
    h.hypothesisReview.changeStatus(
      reviewer(),
      id,
      "strengthening",
      "Two sources agree on the stall.",
    );
    h.hypothesisReview.changeStatus(reviewer(), id, "weakening", "A newer source disagrees.");
    const view = h.hypotheses.get(id);
    expect(view.status).toBe("weakening");
    expect(
      view.statusHistory.map((d) => [d.fromStatus, d.toStatus, d.decidedBy, d.decidedByType]),
    ).toEqual([
      ["untested", "strengthening", "reviewer-1", "human"],
      ["strengthening", "weakening", "reviewer-1", "human"],
    ]);
    expect(view.statusHistory[0]!.note).toBe("Two sources agree on the stall.");
    expect(h.count("audit_event", "action = 'hypothesis.status.strengthening'")).toBe(1);
    expect(h.count("outbox_event", "type = 'hypothesis.updated'")).toBe(2);
  });
  it("refuses a change without a note, a disallowed transition, and a non-reviewer", () => {
    const id = make([h.signal(A.riverbend.id, "Public note about a stalled pilot.").id]);
    expect(
      msg(() => h.hypothesisReview.changeStatus(reviewer(), id, "strengthening", "")),
    ).toContain("note_required");
    expect(
      msg(() => h.hypothesisReview.changeStatus(reviewer(), id, "stale", "trying to set stale")),
    ).toContain("transition_not_allowed");
    for (const actorType of ["ai", "system"] as const) {
      expect(
        msg(() =>
          h.hypothesisReview.changeStatus(
            { userId: null, actorType, correlationId: null },
            id,
            "strengthening",
            "an AI tried",
          ),
        ),
      ).toContain("reviewer_must_be_human");
    }
    expect(
      msg(() =>
        h.hypothesisReview.changeStatus(
          reviewer(),
          "missing",
          "strengthening",
          "no such hypothesis",
        ),
      ),
    ).toContain("unknown_hypothesis");
    expect(h.hypotheses.get(id).status).toBe("untested");
    expect(h.count("audit_event", "action = 'hypothesis.status.refused'")).toBeGreaterThanOrEqual(
      5,
    );
  });
  it("refuses PHI-like notes without echoing them", () => {
    const id = make([h.signal(A.riverbend.id, "Public note about a stalled pilot.").id]);
    const m = msg(() =>
      h.hypothesisReview.changeStatus(
        reviewer(),
        id,
        "strengthening",
        "Patient SSN 000-12-3456 on file",
      ),
    );
    expect(m).toContain("PHI");
    expect(m).not.toContain("000-12-3456");
    expect(
      JSON.stringify(h.db.raw.prepare("SELECT * FROM hypothesis_status_decision").all()),
    ).not.toContain("000-12-3456");
  });
  it("does not accept a proposal's status change before an analyst accepts it", () => {
    const sig = h.signal(A.riverbend.id, "Public note about a stalled pilot.");
    h.db.raw
      .prepare(
        "INSERT INTO research_run (id, account_id, started_by, trigger, state, max_sources, max_cost_micros, summary_json, created_at) VALUES ('r1', ?, 'u','manual','completed',10,2000000,'{}','2026-11-19')",
      )
      .run(A.riverbend.id);
    h.db.raw
      .prepare(
        "INSERT INTO account_hypothesis (id, account_id, origin, acceptance, statement, category, status, confidence_band, confidence_explanation, proposed_by_run_id, ai_model, ai_prompt_version_id, created_at, updated_at) VALUES ('p1', ?, 'ai','proposed','A proposed testable statement.','other',NULL,'low','weak','r1','m','prompt-hypothesis-propose-1.0.0','2026-11-19','2026-11-19')",
      )
      .run(A.riverbend.id);
    void sig;
    expect(
      msg(() =>
        h.hypothesisReview.changeStatus(reviewer(), "p1", "strengthening", "reviewing a proposal"),
      ),
    ).toContain("not_accepted");
  });
});

describe("validated", () => {
  it("is refused with only observed, derived or AI-hypothesis evidence, even many and even approved", () => {
    const observed = h.signal(A.riverbend.id, "Public note about a stalled pilot.");
    const derived = h.signal(A.riverbend.id, "A second note about the same pilot.", {
      typeKey: "program_announcement",
    });
    h.approve(observed.id);
    h.approve(derived.id);
    const id = make([observed.id, derived.id]);
    expect(
      msg(() => h.hypothesisReview.changeStatus(reviewer(), id, "validated", "many signals agree")),
    ).toContain("validated_needs_buyer_confirmed_evidence");
    expect(h.hypotheses.get(id).status).toBe("untested");
  });
  it("is refused for a buyer-confirmed signal that is still pending review, and accepted once it is approved", () => {
    const bc = buyer();
    const id = make([bc.id]);
    expect(
      msg(() => h.hypothesisReview.changeStatus(reviewer(), id, "validated", "buyer confirmed it")),
    ).toContain("validated_needs_buyer_confirmed_evidence");
    h.approve(bc.id);
    h.hypothesisReview.changeStatus(
      reviewer(),
      id,
      "validated",
      "The buyer confirmed it on the call and a reviewer approved the signal.",
    );
    expect(h.hypotheses.get(id)).toMatchObject({
      status: "validated",
      effectiveStatus: "validated",
    });
  });
  it("ignores a buyer-confirmed signal linked only as contradictory", () => {
    const bc = buyer();
    h.approve(bc.id);
    const other = h.signal(A.riverbend.id, "Public note about a stalled pilot.");
    const id = make([other.id]);
    h.hypotheses.link(analyst(), id, bc.id, "contradictory");
    expect(
      msg(() =>
        h.hypothesisReview.changeStatus(reviewer(), id, "validated", "not on a contradictory link"),
      ),
    ).toContain("validated_needs_buyer_confirmed_evidence");
  });
  it("is refused by the database even for a direct write without evidence", () => {
    const id = make([h.signal(A.riverbend.id, "Public note about a stalled pilot.").id]);
    expect(() =>
      h.db.raw
        .prepare(
          "INSERT INTO hypothesis_status_decision (id, hypothesis_id, from_status, to_status, note, decided_by, decided_by_type, decided_at) VALUES ('d', ?, 'untested','validated','forced by a direct write','x','human','2026-11-19')",
        )
        .run(id),
    ).toThrow(/validated needs/);
  });
  it("lets a changed mind move validated to rejected and rejected back to untested", () => {
    const bc = buyer();
    h.approve(bc.id);
    const id = make([bc.id]);
    h.hypothesisReview.changeStatus(reviewer(), id, "validated", "Buyer confirmed and approved.");
    h.hypothesisReview.changeStatus(
      reviewer(),
      id,
      "rejected",
      "The buyer later withdrew the statement.",
    );
    h.hypothesisReview.changeStatus(
      reviewer(),
      id,
      "untested",
      "Reopening for a new round of evidence.",
    );
    expect(h.hypotheses.get(id).statusHistory.map((d) => d.toStatus)).toEqual([
      "validated",
      "rejected",
      "untested",
    ]);
  });
});

describe("review flag", () => {
  it("shows a flag as soon as a supporting signal is rejected and clears it when a reviewer acknowledges with a note", () => {
    const sig = h.signal(A.riverbend.id, "Public note about a stalled pilot.");
    h.approve(sig.id);
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    const id = make([sig.id]);
    expect(h.hypotheses.get(id).flaggedForReview).toBe(false);
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    h.signalReview.review(reviewer(), sig.id, {
      decision: "reject",
      reason: "The source withdrew the note.",
    });
    const flagged = h.hypotheses.get(id);
    expect(flagged).toMatchObject({
      flaggedForReview: true,
      flagReason: "supporting_signal_rejected",
      status: "untested",
    });
    expect(h.hypotheses.list(A.riverbend.id, {}).items[0]).toMatchObject({
      flaggedForReview: true,
    });
    expect(msg(() => h.hypothesisReview.acknowledgeFlag(reviewer(), id, "ab"))).toContain(
      "note_required",
    );
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    h.hypothesisReview.acknowledgeFlag(
      reviewer(),
      id,
      "Looked at it; keeping the hypothesis open.",
    );
    expect(h.hypotheses.get(id)).toMatchObject({ flaggedForReview: false, status: "untested" });
    expect(
      msg(() => h.hypothesisReview.acknowledgeFlag(reviewer(), id, "nothing left to flag")),
    ).toContain("no_flag_to_acknowledge");
  });
});
