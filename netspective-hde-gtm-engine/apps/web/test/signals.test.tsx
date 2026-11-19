// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignalTimeline } from "../src/components/SignalTimeline.js";
import { SignalsView } from "../src/app/signals/signals-view.js";
import { visibleNavItems } from "../src/components/nav.js";
import type { SignalSummary, SignalsApi } from "../src/lib/signals-api.js";

afterEach(cleanup);

const signal = (over: Partial<SignalSummary> = {}): SignalSummary => ({
  id: "s1",
  accountId: "a1",
  typeKey: "implementation_guide_change",
  category: "B",
  taxonomyVersion: 1,
  observation: "The exchange published an updated guide.",
  excerpt: null,
  excerptWithheldReason: "none",
  source: {
    id: "src",
    name: "Official publication (default)",
    ref: "https://example.org/ig",
    unavailableSince: null,
  },
  observedAt: "2026-11-10T00:00:00.000Z",
  publishedAt: null,
  reliability: "high",
  extractionConfidence: "medium",
  evidenceStatus: "observed",
  reviewStatus: "pending",
  isCurrent: false,
  stale: false,
  undated: true,
  freshUntil: "2027-05-10T00:00:00.000Z",
  flags: { newProvenanceSinceReview: false, reverifyRequired: false, contextOnly: false },
  fundingClass: "none",
  regulatoryStatus: null,
  statusLabel: "hypothesis",
  ...over,
});

const apiWith = (items: SignalSummary[], overrides: Partial<SignalsApi> = {}): SignalsApi => ({
  list: vi.fn(async () => ({ items, nextCursor: null })),
  detail: vi.fn(),
  review: vi.fn(async () => ({}) as never),
  accountSignals: vi.fn(),
  types: vi.fn(),
  sources: vi.fn(),
  record: vi.fn(async () => ({ outcome: "created", signal: items[0]! })),
  ...overrides,
});

describe("signal feed", () => {
  it("labels pending, undated, hypothesis and regulatory signals and shows the definitions", async () => {
    const reg = signal({
      id: "s2",
      typeKey: "regulatory_ecosystem_item",
      category: "H",
      flags: { newProvenanceSinceReview: false, reverifyRequired: true, contextOnly: true },
    });
    render(<SignalsView api={apiWith([signal(), reg])} />);
    expect((await screen.findAllByText("pending review", { selector: "li" })).length).toBe(2);
    expect(screen.getAllByText("undated", { selector: "li" }).length).toBe(2);
    expect(screen.getAllByText("hypothesis default", { selector: "li" }).length).toBe(2);
    expect(screen.getByText("re-verify before external use", { selector: "li" })).toBeTruthy();
    expect(screen.getByText("context only", { selector: "li" })).toBeTruthy();
    expect(
      screen.getAllByText(/official publication or a buyer's own statement/i).length,
    ).toBeGreaterThan(0);
  });

  it("passes each filter, alone and combined, to the API", async () => {
    const api = apiWith([signal()]);
    render(<SignalsView api={api} />);
    const user = userEvent.setup();
    await screen.findByText(/Signal Feed/);
    await user.type(screen.getByLabelText("Type"), "onboarding_delay");
    await user.type(screen.getByLabelText("ICP"), "icp1");
    await user.selectOptions(screen.getByLabelText("Freshness"), "stale");
    await user.selectOptions(screen.getByLabelText("Review status"), "approved");
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({
        type: "onboarding_delay",
        icp: "icp1",
        freshness: "stale",
        reviewStatus: "approved",
      }),
    );
    for (const label of ["Organisation", "Source", "Capability", "Offer", "Confidence"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("shows decision controls only to reviewers", async () => {
    const { rerender } = render(<SignalsView api={apiWith([signal()])} canReview={false} />);
    await screen.findByText(/Signal Feed/);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    rerender(<SignalsView api={apiWith([signal()])} canReview />);
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("approves, requires a reason to reject, and needs another signal to mark contradictory", async () => {
    const api = apiWith([
      signal({ id: "s1" }),
      signal({ id: "s2", observation: "A conflicting observation" }),
    ]);
    render(<SignalsView api={api} canReview />);
    const user = userEvent.setup();
    expect(
      (await screen.findAllByRole("group", { name: /Decisions for implementation_guide_change/ }))
        .length,
    ).toBe(2);
    const approveButtons = await screen.findAllByRole("button", { name: "Approve" });
    await user.click(approveButtons[0]!);
    expect(api.review).toHaveBeenCalledWith("s1", { decision: "approve" }, expect.any(String));

    await user.click(screen.getAllByRole("button", { name: "Reject" })[0]!);
    const form = screen.getByRole("form", { name: "Reason" });
    await user.click(within(form).getByRole("button", { name: "Save decision" }));
    expect(api.review).toHaveBeenCalledTimes(1); // no reason, nothing sent
    await user.type(within(form).getByLabelText("Reason"), "source withdrawn");
    await user.click(within(form).getByRole("button", { name: "Save decision" }));
    expect(api.review).toHaveBeenLastCalledWith(
      "s1",
      { decision: "reject", reason: "source withdrawn" },
      expect.any(String),
    );

    await user.click(screen.getAllByRole("button", { name: "Mark contradictory" })[0]!);
    const c = screen.getByRole("form", { name: "Contradiction" });
    await user.selectOptions(within(c).getByLabelText("Contradicts signal"), "s2");
    await user.click(within(c).getByRole("button", { name: "Save decision" }));
    expect(api.review).toHaveBeenLastCalledWith(
      "s1",
      { decision: "contradict", contradictsSignalId: "s2" },
      expect.any(String),
    );
  });

  it("warns about PHI-like text in the record form and shows plain errors", async () => {
    const api = apiWith([], {
      record: vi.fn(async () => Promise.reject(new Error("db exploded"))),
    });
    render(<SignalsView api={api} canRecord />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Observation"), "MRN: 12345");
    expect(screen.getByRole("note").textContent).toMatch(/Do not enter PHI/);
    await user.type(screen.getByLabelText("Organisation id"), "a1");
    await user.type(screen.getByLabelText("Signal type"), "x");
    await user.type(screen.getByLabelText("Source id"), "s");
    await user.type(screen.getByLabelText("URL or identifier"), "r");
    await user.click(screen.getByRole("button", { name: "Record signal" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("db exploded");
  });

  it("shows a plain message when loading fails and when nothing matches", async () => {
    render(
      <SignalsView api={apiWith([], { list: async () => Promise.reject(new Error("boom")) })} />,
    );
    expect((await screen.findByRole("alert")).textContent).not.toContain("boom");
    cleanup();
    render(<SignalsView api={apiWith([])} />);
    expect(await screen.findByText(/No signals match/)).toBeTruthy();
  });
});

describe("signal timeline", () => {
  it("is chronological and distinguishes current, stale, pending and contradictory signals", () => {
    const items = [
      signal({
        id: "old",
        observedAt: "2026-01-01T00:00:00.000Z",
        observation: "Old one",
        stale: true,
        reviewStatus: "approved",
        undated: false,
      }),
      signal({
        id: "new",
        observedAt: "2026-11-01T00:00:00.000Z",
        observation: "New one",
        isCurrent: true,
        reviewStatus: "approved",
        undated: false,
      }),
      signal({
        id: "con",
        observedAt: "2026-06-01T00:00:00.000Z",
        observation: "Conflict",
        reviewStatus: "contradictory",
        undated: false,
      }),
    ];
    render(<SignalTimeline signals={items} />);
    const order = screen
      .getAllByRole("article")
      .map((a) => within(a).getByText(/one|Conflict/).textContent);
    expect(order).toEqual(["New one", "Conflict", "Old one"]);
    expect(screen.getByText("current evidence")).toBeTruthy();
    expect(screen.getByText("stale", { selector: "li" })).toBeTruthy();
    expect(screen.getByText("contradictory", { selector: "li" })).toBeTruthy();
  });

  it("shows an empty state and the withheld-excerpt note with the citation link", () => {
    const { rerender } = render(<SignalTimeline signals={[]} />);
    expect(screen.getByText(/No signals recorded/)).toBeTruthy();
    rerender(<SignalTimeline signals={[signal({ excerptWithheldReason: "source_no_storage" })]} />);
    expect(screen.getByText(/source does not permit storage/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the citation" }).getAttribute("href")).toBe(
      "https://example.org/ig",
    );
  });
});

describe("navigation", () => {
  it("shows Signals only with signals.read", () => {
    expect(visibleNavItems(["signals.read"]).map((i) => i.label)).toEqual(["Signals"]);
    expect(visibleNavItems(["jobs.read"]).map((i) => i.label)).toEqual(["Jobs"]);
  });
});
