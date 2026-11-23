// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecommendationPanel } from "../src/app/accounts/[id]/workspace/recommendation-panel.js";
import { CatalogueApiError } from "../src/lib/catalogue-http.js";
import type { Recommendation, RecommendationsApi } from "../src/lib/recommendations-api.js";

// Task T066: the recommendation panel on the account workspace.
afterEach(cleanup);

const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
  id: "r1",
  accountId: "a1",
  contactId: "c1",
  trigger: "operator",
  requestId: null,
  ruleSetVersion: 1,
  outcome: "offer",
  offerId: "offer-1",
  offerKey: "sender-onboarding-friction-map",
  outreach: "allowed",
  blockedReasons: [],
  eligible: [],
  excluded: [],
  matched: [
    { ruleId: "icp1-onboarding-friction", priority: 10, result: "sender-onboarding-friction-map" },
  ],
  alternatives: [],
  ranking: null,
  aiUsed: false,
  aiFallback: false,
  explanation: "Recommended: Offer 1, by rule icp1-onboarding-friction.",
  limitations: ["The contact's buyer role is not known."],
  outOfDate: false,
  reviewState: "pending",
  reviewedBy: null,
  reviewedAt: null,
  reviewReason: null,
  createdAt: "2026-11-23T10:00:00.000Z",
  ...over,
});
const apiWith = (
  items: Recommendation[],
  over: Partial<RecommendationsApi> = {},
): RecommendationsApi => ({
  list: vi.fn().mockResolvedValue({ items }),
  create: vi.fn().mockResolvedValue(rec()),
  review: vi.fn().mockResolvedValue(rec({ reviewState: "accepted" })),
  addToWaitlist: vi.fn().mockResolvedValue({ id: "w1" }),
  ...over,
});
const ALL = ["offers.read", "offers.recommend", "waitlist.edit"];

describe("recommendation panel", () => {
  it("shows the outcome, rule set version, explanation, limitations and that nothing is sent", async () => {
    render(<RecommendationPanel accountId="a1" permissions={ALL} api={apiWith([rec()])} />);
    expect(
      await screen.findByText(/Recommended: Offer 1, the Sender Onboarding Friction Map/),
    ).toBeTruthy();
    expect(screen.getByText(/Rule set version 1/)).toBeTruthy();
    expect(
      screen.getByText("Recommended: Offer 1, by rule icp1-onboarding-friction."),
    ).toBeTruthy();
    expect(screen.getByText("The contact's buyer role is not known.")).toBeTruthy();
    expect(screen.getByText(/Outreach is allowed. Nothing is sent from here./)).toBeTruthy();
    expect(screen.getByText(/Rules that matched: icp1-onboarding-friction/)).toBeTruthy();
  });

  it("says why outreach is blocked, in plain words", async () => {
    const blocked = rec({
      outcome: "no_action",
      offerKey: null,
      offerId: null,
      outreach: "blocked",
      blockedReasons: ["contact_suppressed"],
    });
    render(<RecommendationPanel accountId="a1" permissions={ALL} api={apiWith([blocked])} />);
    expect(await screen.findByText("No action is recommended")).toBeTruthy();
    expect(
      screen.getByText(/Outreach is blocked: the contact or account is suppressed/),
    ).toBeTruthy();
  });

  it("marks an out-of-date recommendation", async () => {
    render(
      <RecommendationPanel
        accountId="a1"
        permissions={ALL}
        api={apiWith([rec({ outOfDate: true })])}
      />,
    );
    expect(
      await screen.findByText(/Out of date: the facts behind this recommendation have changed/),
    ).toBeTruthy();
  });

  it("accepts with one click and says nothing was sent", async () => {
    const api = apiWith([rec()]);
    render(<RecommendationPanel accountId="a1" permissions={ALL} api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(api.review).toHaveBeenCalledWith("r1", { decision: "accept" }, expect.any(String)),
    );
    expect(await screen.findByText("Accepted. Nothing was sent.")).toBeTruthy();
  });

  it("needs a reason to dismiss", async () => {
    const api = apiWith([rec()]);
    render(<RecommendationPanel accountId="a1" permissions={ALL} api={api} />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss" });
    expect((dismiss as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for dismissing"), {
      target: { value: "Wrong time" },
    });
    expect((dismiss as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(dismiss);
    await waitFor(() =>
      expect(api.review).toHaveBeenCalledWith(
        "r1",
        { decision: "dismiss", reason: "Wrong time" },
        expect.any(String),
      ),
    );
  });

  it("asks for a new recommendation, and shows a plain refusal", async () => {
    const api = apiWith([rec({ reviewState: "accepted" })], {
      create: vi.fn().mockRejectedValue(new CatalogueApiError(403, ["forbidden"])),
    });
    render(<RecommendationPanel accountId="a1" contactId="c1" permissions={ALL} api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Recommend again" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "You do not have permission to do that.",
    );
    expect(api.create).toHaveBeenCalledWith("a1", "c1", expect.any(String));
  });

  it("shows a refused accept with the reason, never the server's own text", async () => {
    const api = apiWith([rec()], {
      review: vi.fn().mockRejectedValue(new CatalogueApiError(409, ["capacity_exhausted"])),
    });
    render(<RecommendationPanel accountId="a1" permissions={ALL} api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/full for that period/);
  });

  it("lists the alternatives for a full offer and adds the account to the wait-list", async () => {
    const full = rec({
      outcome: "research",
      offerKey: null,
      offerId: null,
      excluded: [{ offerKey: "pilot-input-trace-workshop", code: "capacity_exhausted" }],
      alternatives: [
        {
          kind: "wait_list",
          offerKey: "pilot-input-trace-workshop",
          offerId: "offer-6",
          reason:
            "Offer 6 is full for this period; add the account to its wait-list to review when a place opens.",
        },
        {
          kind: "research",
          offerKey: null,
          offerId: null,
          reason: "Gather more evidence about the account before offering anything.",
        },
        {
          kind: "do_nothing",
          offerKey: null,
          offerId: null,
          reason: "Take no action for now; nothing is lost by waiting.",
        },
      ],
    });
    const api = apiWith([full]);
    render(<RecommendationPanel accountId="a1" contactId="c1" permissions={ALL} api={api} />);
    expect(
      await screen.findByText(/Offer 6, the Pilot Input Trace Workshop is full for this period/),
    ).toBeTruthy();
    expect(screen.getByText(/Gather more evidence/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Why wait-list this account"), {
      target: { value: "Full this month" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to the wait-list" }));
    await waitFor(() =>
      expect(api.addToWaitlist).toHaveBeenCalledWith(
        "offer-6",
        { accountId: "a1", contactId: "c1", reason: "Full this month" },
        expect.any(String),
      ),
    );
    expect(
      await screen.findByText(/Added to the wait-list for Offer 6.*Nothing is sent/),
    ).toBeTruthy();
  });

  it("shows no controls without the permissions, and no wait-list form without waitlist.edit", async () => {
    const full = rec({
      alternatives: [
        {
          kind: "wait_list",
          offerKey: "pilot-input-trace-workshop",
          offerId: "offer-6",
          reason: "Offer 6 is full.",
        },
      ],
    });
    render(
      <RecommendationPanel accountId="a1" permissions={["offers.read"]} api={apiWith([full])} />,
    );
    expect(await screen.findByText("Offer 6 is full.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Recommend again/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to the wait-list" })).toBeNull();
  });

  it("offers a first recommendation when there is none, and lists earlier ones", async () => {
    const { rerender } = render(
      <RecommendationPanel accountId="a1" permissions={ALL} api={apiWith([])} />,
    );
    expect(await screen.findByText(/No recommendation has been made/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Get a recommendation" })).toBeTruthy();
    rerender(
      <RecommendationPanel
        accountId="a1"
        permissions={ALL}
        api={apiWith([
          rec({ id: "r2" }),
          rec({ id: "r1", reviewState: "dismissed", ruleSetVersion: 1 }),
        ])}
      />,
    );
    expect(await screen.findByText(/Earlier recommendations/)).toBeTruthy();
  });
});
