import { describe, expect, it } from "vitest";
import {
  HYPOTHESIS_STATUSES,
  checkAssessment,
  checkStatement,
  evaluateStatusChange,
  flagReason,
  isStaleDue,
  lastCurrentAt,
  stalenessAnchor,
} from "../../src/index.js";

// Task T040: hypothesis rules, table-driven. Pure and deterministic; no model anywhere.
describe("statement rule", () => {
  it("accepts hedged, testable statements", () => {
    for (const ok of [
      "Sender onboarding delays after implementation-guide changes may be slowing intake.",
      "The stalled pilot appears to fail because its inputs cannot be traced field by field.",
      "Funding may be approved later this year, which would matter for timing.",
      "Two public sources report different onboarding speeds.",
    ])
      expect(checkStatement(ok), ok).toEqual({ ok: true });
  });
  it("refuses statements that assert qualification, funding path, budget approval, buying authority or a buyer's decision", () => {
    const cases: [string, string][] = [
      ["This organisation is qualified for a Sender Readiness Sprint.", "asserts_qualification"],
      ["The account is a sales-qualified lead.", "asserts_qualification"],
      ["The funding path is confirmed for this programme.", "asserts_funding_path"],
      ["The budget has been approved for the data platform work.", "asserts_budget_approval"],
      ["Budget is secured and funding is allocated.", "asserts_budget_approval"],
      ["The economic buyer is confirmed as the CIO.", "asserts_buying_authority"],
      ["The CFO holds buying authority for this project.", "asserts_buying_authority"],
      ["The organisation has decided to buy a readiness sprint.", "asserts_buyer_decision"],
      ["They will buy once the pilot ends.", "asserts_buyer_decision"],
    ];
    for (const [text, code] of cases)
      expect(checkStatement(text), text).toEqual({ ok: false, code });
  });
  it("bounds the length at 10 to 500 characters and never echoes the text", () => {
    expect(checkStatement("short")).toEqual({ ok: false, code: "statement_length" });
    expect(checkStatement("x".repeat(501))).toEqual({ ok: false, code: "statement_length" });
    expect(JSON.stringify(checkStatement("The funding path is confirmed."))).not.toContain(
      "confirmed",
    );
  });
});

describe("status machine", () => {
  const human = { kind: "human" as const };
  const go = (from: string, to: string, over: Record<string, unknown> = {}) =>
    evaluateStatusChange({
      from: from as never,
      to: to as never,
      note: "reviewed the evidence",
      actor: human,
      hasValidatingEvidence: false,
      ...over,
    });
  it("allows exactly the documented transitions", () => {
    const allowed: Record<string, string[]> = {
      untested: ["strengthening", "weakening", "rejected", "validated"],
      strengthening: ["weakening", "rejected", "validated"],
      weakening: ["strengthening", "rejected", "validated"],
      validated: ["weakening", "rejected"],
      rejected: ["untested"],
      stale: ["untested", "strengthening", "weakening"],
    };
    for (const from of HYPOTHESIS_STATUSES) {
      for (const to of HYPOTHESIS_STATUSES) {
        const r = go(from, to, { hasValidatingEvidence: true });
        expect(r.ok, `${from} -> ${to}`).toBe((allowed[from] ?? []).includes(to));
      }
    }
  });
  it("needs a note of at least 3 characters and a human reviewer", () => {
    expect(go("untested", "strengthening", { note: "" })).toEqual({
      ok: false,
      code: "note_required",
    });
    expect(go("untested", "strengthening", { note: "ab" })).toEqual({
      ok: false,
      code: "note_required",
    });
    for (const kind of ["ai", "system"] as const)
      expect(go("untested", "strengthening", { actor: { kind } })).toEqual({
        ok: false,
        code: "reviewer_must_be_human",
      });
  });
  it("lets validated through only with a supporting approved buyer-confirmed signal", () => {
    expect(go("strengthening", "validated")).toEqual({
      ok: false,
      code: "validated_needs_buyer_confirmed_evidence",
    });
    expect(go("strengthening", "validated", { hasValidatingEvidence: true })).toEqual({ ok: true });
  });
  it("lets only the staleness rule set stale", () => {
    expect(go("untested", "stale")).toMatchObject({ ok: false });
    expect(
      evaluateStatusChange({
        from: "weakening",
        to: "stale",
        note: "no current evidence for 90 days",
        actor: { kind: "system" },
        hasValidatingEvidence: false,
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateStatusChange({
        from: "validated",
        to: "stale",
        note: "x y z",
        actor: { kind: "system" },
        hasValidatingEvidence: true,
      }),
    ).toMatchObject({ ok: false });
    expect(
      evaluateStatusChange({
        from: "untested",
        to: "strengthening",
        note: "x y z",
        actor: { kind: "system" },
        hasValidatingEvidence: false,
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("staleness", () => {
  const D = 86_400_000;
  const now = new Date("2026-11-19T00:00:00.000Z");
  it("takes the latest instant a supporting signal counted as current, now if one still does", () => {
    expect(lastCurrentAt([], now)).toBeNull();
    expect(lastCurrentAt([{ currentNow: false, currentEndedAt: null }], now)).toBeNull();
    expect(
      lastCurrentAt(
        [
          { currentNow: false, currentEndedAt: "2026-06-01T00:00:00.000Z" },
          { currentNow: false, currentEndedAt: "2026-08-01T00:00:00.000Z" },
        ],
        now,
      ),
    ).toBe("2026-08-01T00:00:00.000Z");
    expect(
      lastCurrentAt(
        [
          { currentNow: true, currentEndedAt: null },
          { currentNow: false, currentEndedAt: "2026-01-01T00:00:00.000Z" },
        ],
        now,
      ),
    ).toBe(now.toISOString());
  });
  it("anchors on the latest of last-current, acceptance and revival", () => {
    expect(
      stalenessAnchor({
        lastCurrentAt: "2026-06-01T00:00:00.000Z",
        acceptedAt: "2026-05-01T00:00:00.000Z",
        lastRevivedAt: null,
      }),
    ).toBe("2026-06-01T00:00:00.000Z");
    expect(
      stalenessAnchor({
        lastCurrentAt: null,
        acceptedAt: "2026-05-01T00:00:00.000Z",
        lastRevivedAt: "2026-07-01T00:00:00.000Z",
      }),
    ).toBe("2026-07-01T00:00:00.000Z");
  });
  it("is due at exactly the window and only for open statuses", () => {
    const anchor = new Date(now.getTime() - 90 * D).toISOString();
    for (const status of ["untested", "strengthening", "weakening"] as const) {
      expect(isStaleDue({ status, anchor, now, staleDays: 90 })).toBe(true);
      expect(
        isStaleDue({
          status,
          anchor: new Date(now.getTime() - 89 * D - 1).toISOString(),
          now,
          staleDays: 90,
        }),
      ).toBe(false);
    }
    for (const status of ["validated", "rejected", "stale"] as const)
      expect(isStaleDue({ status, anchor, now, staleDays: 90 })).toBe(false);
    expect(isStaleDue({ status: "untested", anchor, now, staleDays: 90 })).toBe(
      isStaleDue({ status: "untested", anchor, now, staleDays: 90 }),
    );
  });
  it("flags a hypothesis when a supporting signal was rejected, contradicted or went stale after the last review", () => {
    const at = "2026-10-01T00:00:00.000Z";
    expect(flagReason([], at)).toBeNull();
    expect(flagReason([{ state: "rejected", eventAt: "2026-10-02T00:00:00.000Z" }], at)).toBe(
      "supporting_signal_rejected",
    );
    expect(flagReason([{ state: "rejected", eventAt: "2026-09-02T00:00:00.000Z" }], at)).toBeNull();
    expect(
      flagReason(
        [
          { state: "contradicted", eventAt: "2026-10-03T00:00:00.000Z" },
          { state: "stale", eventAt: "2026-10-04T00:00:00.000Z" },
        ],
        at,
      ),
    ).toBe("supporting_signal_contradicted");
    expect(flagReason([{ state: "stale", eventAt: "2026-10-05T00:00:00.000Z" }], at)).toBe(
      "supporting_signal_stale",
    );
  });
});

describe("confidence assessments", () => {
  it("accepts only bands with an explanation and refuses the reserved and hypothesis dimensions", () => {
    expect(
      checkAssessment({ dimension: "extraction", band: "high", explanation: "Quoted text." }),
    ).toEqual({ ok: true });
    expect(checkAssessment({ dimension: "extraction", band: "0.9", explanation: "x" })).toEqual({
      ok: false,
      code: "band_invalid",
    });
    expect(checkAssessment({ dimension: "extraction", band: "low", explanation: "ab" })).toEqual({
      ok: false,
      code: "explanation_required",
    });
    for (const d of ["icp_fit", "offer_fit", "qualification_completeness"])
      expect(checkAssessment({ dimension: d, band: "low", explanation: "text here" })).toEqual({
        ok: false,
        code: "dimension_reserved",
      });
    expect(
      checkAssessment({ dimension: "hypothesis", band: "low", explanation: "text here" }),
    ).toEqual({ ok: false, code: "dimension_not_written" });
    expect(
      checkAssessment({ dimension: "nonsense", band: "low", explanation: "text here" }),
    ).toEqual({ ok: false, code: "dimension_unknown" });
  });
});
