// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimsView, sentenceAround } from "../src/app/claims/claims-view.js";
import { CatalogueApiError } from "../src/lib/catalogue-http.js";
import type { ClaimDetail, ClaimSummary, ClaimsApi, LintMatch } from "../src/lib/claims-api.js";

afterEach(cleanup);

const summary = (over: Partial<ClaimSummary> = {}): ClaimSummary => ({
  id: "c1",
  text: "We reduced rejections by 40% last year.",
  declaredClass: null,
  effectiveClass: "quantified_outcome",
  status: "in_review",
  restricted: true,
  approvalsNeeded: 2,
  approvalsHave: 1,
  draftedBy: "drafter-1",
  draftedAt: "2026-11-19T00:00:00.000Z",
  versionNo: 1,
  ...over,
});
const match: LintMatch = {
  class: "quantified_outcome",
  ruleId: "outcome-percentage",
  start: 26,
  end: 29,
  text: "40%",
  covered: false,
};
const detail = (over: Partial<ClaimDetail> = {}): ClaimDetail => ({
  ...summary(),
  evidence: [
    {
      id: "e1",
      kind: "document",
      reference: "report-1",
      owner: "Service lead",
      expiresAt: "2027-11-19T00:00:00.000Z",
      withdrawnAt: null,
      valid: true,
    },
  ],
  reviews: [
    {
      decision: "approve",
      reviewerId: "lead-1",
      note: "Checked the evidence",
      decidedAt: "2026-11-19T00:00:00.000Z",
    },
  ],
  lint: { listVersion: 1, matches: [match] },
  suggestion: "Omit the statement until it is approved with valid evidence.",
  ...over,
});
function fakeApi(items: ClaimSummary[], d: ClaimDetail, over: Partial<ClaimsApi> = {}): ClaimsApi {
  return {
    list: vi.fn(async () => ({ items })),
    get: vi.fn(async () => d),
    review: vi.fn(async () => d),
    markFalsePositive: vi.fn(async () => ({ id: "d1" })),
    ...over,
  };
}
const open = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Open claim" }));
  await screen.findByRole("region", { name: "Claim" });
};
const APPROVER = ["claims.read", "claims.approve"];

describe("the queue", () => {
  it("lists claims with status, class and approvals, and marks needs review", async () => {
    const items = [
      summary(),
      summary({
        id: "c2",
        text: "We review feeds weekly.",
        restricted: false,
        effectiveClass: "general",
        status: "needs_review",
        approvalsNeeded: 1,
        approvalsHave: 1,
      }),
    ];
    render(<ClaimsView permissions={["claims.read"]} userId="u9" api={fakeApi(items, detail())} />);
    expect(await screen.findByText(/We reduced rejections/)).toBeTruthy();
    expect(screen.getByText(/Status: in review/)).toBeTruthy();
    expect(screen.getByText(/Restricted claim, 1 of 2 approvals/)).toBeTruthy();
    expect(screen.getByText(/Status: Needs review/)).toBeTruthy();
    expect(screen.getByText(/General claim, 1 of 1 approvals/)).toBeTruthy();
  });

  it("filters by status through the API", async () => {
    const api = fakeApi([summary()], detail());
    render(<ClaimsView permissions={["claims.read"]} userId="u9" api={api} />);
    await screen.findByText(/We reduced rejections/);
    fireEvent.change(screen.getByLabelText("Show claims"), { target: { value: "needs_review" } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith("needs_review"));
  });
});

describe("a claim", () => {
  it("shows evidence with expiry, checker results with class and matched text, reviews and the suggestion to omit", async () => {
    render(
      <ClaimsView permissions={["claims.read"]} userId="u9" api={fakeApi([summary()], detail())} />,
    );
    await open();
    expect(
      screen.getByText(/report-1 \(owner Service lead\). Expires 2027-11-19. Valid./),
    ).toBeTruthy();
    expect(
      screen.getByText(/quantified outcome: “40%” \(outcome-percentage\). Not covered./),
    ).toBeTruthy();
    expect(screen.getByText(/Approved by lead-1: Checked the evidence/)).toBeTruthy();
    expect(screen.getByText(/Omit the statement until it is approved/)).toBeTruthy();
  });

  it("says when there is no evidence and when no restricted phrase was found", async () => {
    render(
      <ClaimsView
        permissions={["claims.read"]}
        userId="u9"
        api={fakeApi(
          [summary()],
          detail({ evidence: [], reviews: [], lint: { listVersion: 1, matches: [] } }),
        )}
      />,
    );
    await open();
    expect(screen.getByText("No evidence linked.")).toBeTruthy();
    expect(screen.getByText("No restricted phrases found.")).toBeTruthy();
  });

  it("shows a needs review notice when the evidence has lapsed", async () => {
    render(
      <ClaimsView
        permissions={["claims.read"]}
        userId="u9"
        api={fakeApi(
          [summary({ status: "needs_review" })],
          detail({
            status: "needs_review",
            suggestion: undefined,
            evidence: [
              {
                id: "e1",
                kind: "document",
                reference: "r",
                owner: "o",
                expiresAt: "2026-01-01T00:00:00.000Z",
                withdrawnAt: null,
                valid: false,
              },
            ],
          }),
        )}
      />,
    );
    await open();
    expect(
      screen.getByText(/Needs review: the evidence has been withdrawn or has expired/),
    ).toBeTruthy();
    expect(screen.getByText(/No longer valid/)).toBeTruthy();
  });

  it("shows approve and reject only to a designated approver, and calls the API with a note", async () => {
    const api = fakeApi([summary()], detail());
    const { unmount } = render(<ClaimsView permissions={["claims.read"]} userId="u9" api={api} />);
    await open();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    unmount();
    render(<ClaimsView permissions={APPROVER} userId="u9" api={api} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/note of at least 3 characters/);
    expect(api.review).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Review note"), {
      target: { value: "Evidence checked" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(api.review).toHaveBeenCalledWith(
        "c1",
        "reject",
        "Evidence checked",
        expect.any(String),
      ),
    );
  });

  it("does not offer review to the person who drafted the claim", async () => {
    render(
      <ClaimsView permissions={APPROVER} userId="drafter-1" api={fakeApi([summary()], detail())} />,
    );
    await open();
    expect(screen.getByText(/You drafted this claim, so you cannot review it/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("does not offer review once the claim is decided", async () => {
    render(
      <ClaimsView
        permissions={APPROVER}
        userId="u9"
        api={fakeApi(
          [summary({ status: "approved" })],
          detail({ status: "approved", suggestion: undefined }),
        )}
      />,
    );
    await open();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("marks a flag as a false positive with a reason, for the sentence around it", async () => {
    const api = fakeApi([summary()], detail());
    render(<ClaimsView permissions={APPROVER} userId="u9" api={api} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Mark as false positive" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /reason of at least 3 characters/,
    );
    fireEvent.change(screen.getByLabelText("Reason for a false positive"), {
      target: { value: "A page number" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark as false positive" }));
    await waitFor(() =>
      expect(api.markFalsePositive).toHaveBeenCalledWith(
        {
          sentence: "We reduced rejections by 40% last year.",
          ruleId: "outcome-percentage",
          reason: "A page number",
        },
        expect.any(String),
      ),
    );
  });

  it("hides the false-positive control from a reader", async () => {
    render(
      <ClaimsView permissions={["claims.read"]} userId="u9" api={fakeApi([summary()], detail())} />,
    );
    await open();
    expect(screen.queryByRole("button", { name: "Mark as false positive" })).toBeNull();
  });

  it.each([
    ["claim_needs_evidence", /Link valid evidence before approving/],
    ["drafter_cannot_approve", /person who drafted a claim cannot review it/],
    ["already_reviewed", /already reviewed this claim/],
    ["rejected", /claim was rejected/],
  ])("shows a plain message for the refusal %s", async (code, message) => {
    const api = fakeApi([summary()], detail(), {
      review: vi.fn(async () => {
        throw new CatalogueApiError(409, [code]);
      }),
    });
    render(<ClaimsView permissions={APPROVER} userId="u9" api={api} />);
    await open();
    fireEvent.change(screen.getByLabelText("Review note"), {
      target: { value: "Evidence checked" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
  });

  it("warns when a note looks like it contains patient information", async () => {
    render(<ClaimsView permissions={APPROVER} userId="u9" api={fakeApi([summary()], detail())} />);
    await open();
    fireEvent.change(screen.getByLabelText("Review note"), {
      target: { value: "SSN: 123-45-6789" },
    });
    expect(screen.getByText(/Do not enter PHI here/)).toBeTruthy();
  });
});

describe("sentenceAround", () => {
  it("returns the sentence that holds the match", () => {
    const text = "We review feeds. We reduced rejections by 40% last year. Next steps follow.";
    const start = text.indexOf("40%");
    expect(sentenceAround(text, { ...match, start, end: start + 3 })).toBe(
      "We reduced rejections by 40% last year.",
    );
  });
  it("returns the whole text for a single sentence", () => {
    expect(
      sentenceAround("A guaranteed result", { ...match, start: 2, end: 12, text: "guaranteed" }),
    ).toBe("A guaranteed result");
  });
});
