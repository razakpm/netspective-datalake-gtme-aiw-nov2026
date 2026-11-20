import { describe, expect, it } from "vitest";
import { checkText } from "../src/modules/claims/index.js";
import { buildCatalogueHarness, type CatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T048: two-person review of restricted claims (quickstart V3 to V7; spec FR-003, FR-007, SC-002).
const RESTRICTED = "We reduced sender rejections by 40% in one quarter.";
const GENERAL = "We review sender feeds every week.";

const withEvidence = (h: CatalogueHarness, text: string) => {
  const c = h.claims.draft(h.actor("drafter"), { text });
  h.claims.addEvidence(h.actor("drafter"), c.id, {
    kind: "document",
    reference: "report-1",
    owner: "Service lead",
  });
  return c.id;
};
const review = (
  h: CatalogueHarness,
  who: Parameters<CatalogueHarness["actor"]>[0],
  id: string,
  decision: "approve" | "reject" = "approve",
  note = "Checked the evidence",
) => h.claimReview.review(h.actor(who), id, { decision, note });

describe("a restricted claim", () => {
  it("cannot be approved without valid evidence and the suggestion is to omit it", () => {
    const h = buildCatalogueHarness();
    const c = h.claims.draft(h.actor("drafter"), { text: RESTRICTED });
    expect(c).toMatchObject({ restricted: true, approvalsNeeded: 2 });
    expect(() => review(h, "lead", c.id)).toThrow(/Omit the statement/);
    expect(h.audit("claim.review.refused")[0]?.after_summary).toContain("claim_needs_evidence");
    expect(h.claims.get(h.actor("lead"), c.id)).toMatchObject({
      status: "draft",
      approvalsHave: 0,
    });
    expect(h.count("claim_review")).toBe(0);
  });

  it("stays in review after one approver and is approved by a second different approver", () => {
    const h = buildCatalogueHarness();
    const id = withEvidence(h, RESTRICTED);
    const first = review(h, "lead", id);
    expect(first).toMatchObject({ status: "in_review", approvalsHave: 1, approvalsNeeded: 2 });
    expect(first.suggestion).toBeDefined();
    const second = review(h, "marketing", id);
    expect(second).toMatchObject({ status: "approved", approvalsHave: 2 });
    expect(second.suggestion).toBeUndefined();
    expect(second.reviews.map((r) => [r.reviewerId, r.decision])).toEqual([
      ["lead-1", "approve"],
      ["marketing-1", "approve"],
    ]);
  });

  it("does not count the same approver twice", () => {
    const h = buildCatalogueHarness();
    const id = withEvidence(h, RESTRICTED);
    review(h, "lead", id);
    expect(() => review(h, "lead", id)).toThrow(/already reviewed/i);
    expect(h.claims.get(h.actor("lead"), id).status).toBe("in_review");
    expect(h.count("claim_review")).toBe(1);
  });

  it("refuses the drafter, even a designated approver, for approval and rejection", () => {
    const h = buildCatalogueHarness();
    const c = h.claims.draft(h.actor("marketing"), { text: RESTRICTED });
    h.claims.addEvidence(h.actor("marketing"), c.id, {
      kind: "document",
      reference: "report-1",
      owner: "Marketing",
    });
    expect(() => review(h, "marketing", c.id)).toThrow(/drafted/i);
    expect(() => review(h, "marketing", c.id, "reject")).toThrow(/drafted/i);
    expect(
      h
        .audit("claim.review.refused")
        .every((a) => a.after_summary?.includes("drafter_cannot_approve")),
    ).toBe(true);
    expect(h.count("claim_review")).toBe(0);
  });

  it("is stopped by any rejection, and nothing is approved after it", () => {
    const h = buildCatalogueHarness();
    const id = withEvidence(h, RESTRICTED);
    review(h, "lead", id, "approve");
    expect(review(h, "marketing", id, "reject", "Evidence is too thin").status).toBe("rejected");
    expect(() => review(h, "lead2", id)).toThrow(/rejected/i);
    expect(h.claims.get(h.actor("lead"), id).status).toBe("rejected");
  });

  it("can be rejected without evidence", () => {
    const h = buildCatalogueHarness();
    const c = h.claims.draft(h.actor("drafter"), { text: RESTRICTED });
    expect(review(h, "lead", c.id, "reject", "Not supportable").status).toBe("rejected");
  });

  it("is refused when the only evidence has expired", () => {
    const h = buildCatalogueHarness();
    const c = h.claims.draft(h.actor("drafter"), { text: RESTRICTED });
    h.claims.addEvidence(h.actor("drafter"), c.id, {
      kind: "document",
      reference: "report-1",
      owner: "Service lead",
      expiresAt: "2026-11-25T00:00:00.000Z",
    });
    h.advanceDays(10);
    expect(() => review(h, "lead", c.id)).toThrow(/Omit the statement/);
  });
});

describe("a general claim", () => {
  it("needs valid evidence and one approval", () => {
    const h = buildCatalogueHarness();
    const bare = h.claims.draft(h.actor("drafter"), { text: GENERAL });
    expect(() => review(h, "lead", bare.id)).toThrow(/Omit the statement/);
    const id = withEvidence(h, "We review feeds weekly for every sender.");
    expect(review(h, "lead", id)).toMatchObject({ status: "approved", approvalsNeeded: 1 });
  });

  it("is treated as restricted when the phrase list now flags its text", () => {
    const h = buildCatalogueHarness();
    const id = withEvidence(h, GENERAL);
    h.db.raw
      .prepare("UPDATE claim SET effective_class = 'general', text = ? WHERE id = ?")
      .run("We are SOC 2 compliant and proud.", id);
    expect(review(h, "lead", id)).toMatchObject({
      status: "in_review",
      approvalsNeeded: 2,
      effectiveClass: "certification",
    });
  });
});

describe("who may review and when", () => {
  it("needs claims.approve, and an AI actor never reviews", () => {
    const h = buildCatalogueHarness();
    const id = withEvidence(h, GENERAL);
    for (const who of ["analyst", "drafter", "operator", "executive"] as const) {
      expect(() => review(h, who, id), who).toThrow(/permission/);
    }
    expect(() =>
      h.claimReview.review({ ...h.actor("lead"), actorType: "ai" }, id, {
        decision: "approve",
        note: "Looks fine",
      }),
    ).toThrow(/permission/);
    expect(h.count("claim_review")).toBe(0);
  });

  it("refuses a note under three characters and PHI-like text", () => {
    const h = buildCatalogueHarness();
    const id = withEvidence(h, GENERAL);
    expect(() => review(h, "lead", id, "approve", "ok")).toThrow(/Invalid fields/);
    expect(() => review(h, "lead", id, "approve", "Patient 123-45-6789 file")).toThrow();
    expect(h.count("claim_review")).toBe(0);
    expect(h.anyText(/123-45-6789/)).toBe(false);
  });

  it("closes the claim once approved or rejected", () => {
    const h = buildCatalogueHarness();
    const id = withEvidence(h, GENERAL);
    review(h, "lead", id);
    expect(() => review(h, "marketing", id)).toThrow(/already/i);
  });

  it("refuses an unknown claim", () => {
    const h = buildCatalogueHarness();
    expect(() => review(h, "lead", "claim-nope")).toThrow(/not found/i);
  });
});

describe("audit and events", () => {
  it("records who, when and why, emits claim.reviewed with identifiers only and never the note", () => {
    const h = buildCatalogueHarness();
    const id = withEvidence(h, RESTRICTED);
    review(h, "lead", id, "approve", "Private reviewer note text");
    review(h, "marketing", id, "approve", "Another private note");
    expect(h.audit("claim.review").map((a) => a.actor_id)).toEqual(["lead-1", "marketing-1"]);
    expect(h.outbox("claim.reviewed")).toEqual([
      { claim_id: id, decision: "approve", claim_status: "in_review" },
      { claim_id: id, decision: "approve", claim_status: "approved" },
    ]);
    expect(h.anyText(/Private reviewer note|Another private note/)).toBe(false);
    const rows = h.db.raw.prepare("SELECT decided_at, note FROM claim_review").all() as {
      decided_at: string;
      note: string;
    }[];
    expect(rows.every((r) => r.decided_at === h.now().toISOString() && r.note.length >= 3)).toBe(
      true,
    );
  });

  it("makes an approved claim cover its exact sentence until its evidence expires", () => {
    const h = buildCatalogueHarness();
    const c = h.claims.draft(h.actor("drafter"), { text: "We are SOC 2 compliant." });
    h.claims.addEvidence(h.actor("drafter"), c.id, {
      kind: "document",
      reference: "audit-1",
      owner: "Security",
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    review(h, "lead", c.id);
    review(h, "marketing", c.id);
    const covered = () =>
      h.db.transaction((tx) =>
        checkText(tx, "We are SOC 2 compliant.", h.now().toISOString()).matches.map(
          (m) => m.covered,
        ),
      );
    expect(covered()).toEqual([true]);
    h.advanceDays(30);
    expect(h.claims.get(h.actor("lead"), c.id).status).toBe("needs_review");
    expect(covered()).toEqual([false]);
  });
});

describe("withdrawing", () => {
  it("lets the drafter withdraw a draft but only an approver withdraw an approved claim", () => {
    const h = buildCatalogueHarness();
    const draft = h.claims.draft(h.actor("drafter"), { text: GENERAL });
    expect(
      h.claimReview.withdraw(h.actor("drafter"), draft.id, { note: "Not needed any more" }).status,
    ).toBe("withdrawn");
    const id = withEvidence(h, "We review feeds weekly for every sender.");
    review(h, "lead", id);
    expect(() =>
      h.claimReview.withdraw(h.actor("drafter"), id, { note: "Changed my mind" }),
    ).toThrow(/permission/);
    expect(h.claimReview.withdraw(h.actor("lead"), id, { note: "Retired statement" }).status).toBe(
      "withdrawn",
    );
    expect(h.count("outbox_event", "type = 'claim.reviewed'")).toBe(1);
    expect(h.audit("claim.withdraw")).toHaveLength(2);
  });

  it("withdraws evidence once, turning an approved claim into needs_review", () => {
    const h = buildCatalogueHarness();
    const id = withEvidence(h, "We review feeds weekly for every sender.");
    review(h, "lead", id);
    const evidenceId = h.claims.get(h.actor("lead"), id).evidence[0]!.id;
    expect(() => h.claimReview.withdrawEvidence(h.actor("drafter"), id, evidenceId)).toThrow(
      /permission/,
    );
    const detail = h.claimReview.withdrawEvidence(h.actor("lead"), id, evidenceId);
    expect(detail.status).toBe("needs_review");
    expect(detail.evidence[0]).toMatchObject({ valid: false });
    expect(() => h.claimReview.withdrawEvidence(h.actor("lead"), id, evidenceId)).toThrow(
      /already/i,
    );
    expect(h.audit("claim.evidence.withdraw")).toHaveLength(1);
  });
});
