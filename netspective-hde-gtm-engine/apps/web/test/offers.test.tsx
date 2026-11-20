// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OffersView } from "../src/app/offers/offers-view.js";
import { CatalogueApiError } from "../src/lib/catalogue-http.js";
import type {
  CapacityStatus,
  Limitation,
  OfferDetail,
  OfferSnapshot,
  OfferSummary,
  OfferVersion,
  OffersApi,
} from "../src/lib/offers-api.js";

afterEach(cleanup);

const capacity = (over: Partial<CapacityStatus> = {}): CapacityStatus => ({
  offerId: "offer-6",
  state: "room",
  periodKind: "month",
  periodStart: "2026-11-01",
  periodEnd: "2026-12-01",
  limit: 3,
  used: 1,
  held: 0,
  remaining: 2,
  utilisation: 1 / 3,
  offerStatus: "approved",
  ...over,
});
const summary = (over: Partial<OfferSummary> = {}): OfferSummary => ({
  id: "offer-6",
  number: 6,
  key: "pilot-input-trace-workshop",
  name: "Pilot Input Trace Workshop",
  lockNo: 1,
  status: "approved",
  inForceVersionNo: 1,
  latestVersionNo: 1,
  latestStatus: "approved",
  baselineIncomplete: false,
  acknowledgementStale: false,
  claimCover: { status: "ok", claimIds: [], ruleIds: [] },
  capacity: capacity(),
  ...over,
});
const snapshot = (over: Partial<OfferSnapshot> = {}): OfferSnapshot => ({
  name: "Pilot Input Trace Workshop",
  format: null,
  targetIcp: null,
  buyerOutput: null,
  buyerEffort: null,
  effortEstimate: { text: null, status: "hypothesis" },
  conversionPath: null,
  landingPagePromise: null,
  cta: null,
  intakeFields: null,
  successHypotheses: null,
  sqlRuleRef: "sql-offer-6",
  relatedCapabilityKeys: [],
  paidTypeKey: "input_audit",
  ...over,
});
const version = (over: Partial<OfferVersion> = {}): OfferVersion => ({
  offerId: "offer-6",
  versionNo: 1,
  snapshot: snapshot(),
  placeholderAttributes: ["format", "buyerOutput"],
  status: "approved",
  superseded: false,
  history: [
    { status: "draft", changedBy: "seed", note: null, changedAt: "2026-11-19T00:00:00.000Z" },
    {
      status: "approved",
      changedBy: "seed",
      note: "Baseline",
      changedAt: "2026-11-19T00:00:01.000Z",
    },
  ],
  reason: "Seed",
  createdBy: "seed",
  createdAt: "2026-11-19T00:00:00.000Z",
  ...over,
});
const limitation = (over: Partial<Limitation> = {}): Limitation => ({
  id: "lim-1",
  key: "evaluation_is_buyer_prompt_only",
  wording: "Evaluation is a buyer prompt only",
  active: true,
  acknowledged: false,
  acknowledgedBy: null,
  acknowledgedAt: null,
  acknowledgementStale: false,
  ...over,
});
const detail = (over: Partial<OfferDetail> = {}): OfferDetail => ({
  ...summary(),
  latest: version(),
  inForce: version(),
  limitations: [limitation()],
  ...over,
});

function fakeApi(
  over: Partial<OffersApi> = {},
  offers: OfferSummary[] = [summary()],
  d: OfferDetail = detail(),
): OffersApi {
  return {
    list: vi.fn(async () => ({ items: offers })),
    get: vi.fn(async () => d),
    versions: vi.fn(async () => ({ items: [d.latest] })),
    moveStatus: vi.fn(async () => d.latest),
    acknowledge: vi.fn(async () => limitation({ acknowledged: true, acknowledgedBy: "lead-1" })),
    setCapacity: vi.fn(async () => ({})),
    bookings: vi.fn(async () => ({
      items: [
        {
          id: "b1",
          offerId: "offer-6",
          externalRef: null,
          state: "booked" as const,
          sessionDate: "2026-11-20",
          periodStart: "2026-11-01",
          source: "manual" as const,
        },
      ],
    })),
    recordBooking: vi.fn(async () => ({
      id: "b2",
      offerId: "offer-6",
      externalRef: null,
      state: "booked" as const,
      sessionDate: "2026-11-21",
      periodStart: "2026-11-01",
      source: "manual" as const,
    })),
    updateBooking: vi.fn(async () => ({
      id: "b1",
      offerId: "offer-6",
      externalRef: null,
      state: "cancelled" as const,
      sessionDate: "2026-11-20",
      periodStart: "2026-11-01",
      source: "manual" as const,
    })),
    scores: vi.fn(async () => ({
      label: "Judgement scores: every score is a hypothesis.",
      criteria: [],
      scores: [],
    })),
    ...over,
  };
}
const open = async (n = 6) => {
  fireEvent.click(await screen.findByRole("button", { name: `Open offer ${n}` }));
  await screen.findByRole("region", { name: `Offer ${n}` });
};
const ALL = [
  "offers.read",
  "offers.edit",
  "offers.status.change",
  "offers.limitations.acknowledge",
  "offers.capacity.edit",
  "offers.bookings.edit",
];

describe("the offer list", () => {
  it("shows each offer's status, capacity and the placeholder, stale and lapsed notices", async () => {
    const offers = [
      summary({ baselineIncomplete: true }),
      summary({
        id: "offer-7",
        number: 7,
        name: null,
        status: "draft",
        capacity: capacity({
          offerId: "offer-7",
          state: "no_limit_set",
          limit: null,
          remaining: null,
          utilisation: null,
        }),
        acknowledgementStale: true,
      }),
      summary({
        id: "offer-1",
        number: 1,
        name: "Sender Onboarding Friction Map",
        capacity: capacity({
          state: "exhausted",
          used: 3,
          remaining: 0,
          utilisation: 1,
          periodKind: "week",
        }),
        claimCover: { status: "lapsed", claimIds: ["c1"], ruleIds: ["soc2"] },
      }),
    ];
    render(<OffersView permissions={["offers.read"]} api={fakeApi({}, offers)} />);
    expect(await screen.findByText(/Offer 6: Pilot Input Trace Workshop/)).toBeTruthy();
    expect(screen.getByText(/Offer 7: To be provided/)).toBeTruthy();
    expect(screen.getByText(/1 of 3 sessions used this month/)).toBeTruthy();
    expect(screen.getByText(/No limit set \(this does not mean unlimited\)/)).toBeTruthy();
    expect(screen.getByText(/Full: 3 of 3 sessions this week/)).toBeTruthy();
    expect(screen.getByText(/Baseline: attributes incomplete/)).toBeTruthy();
    expect(screen.getByText(/acknowledgement is stale/)).toBeTruthy();
    expect(screen.getByText(/Claim cover has lapsed/)).toBeTruthy();
  });

  it("reaches an offer's status and limitations in one interaction", async () => {
    const api = fakeApi();
    render(<OffersView permissions={["offers.read"]} api={api} />);
    expect(await screen.findByText(/Status: approved/)).toBeTruthy();
    await open();
    expect(screen.getByText(/Evaluation is a buyer prompt only/)).toBeTruthy();
    expect(screen.getByText(/Version 1: approved/)).toBeTruthy();
  });
});

describe("the offer detail", () => {
  it("labels the effort estimate and scores as hypotheses and the missing details as to be provided", async () => {
    render(<OffersView permissions={["offers.read"]} api={fakeApi({}, [summary()], detail())} />);
    await open();
    expect(
      screen.getByText(/Netspective effort estimate \(hypothesis\): to be provided/),
    ).toBeTruthy();
    expect(screen.getByText(/Still to be provided: format, buyerOutput/)).toBeTruthy();
    expect(screen.getByText(/Judgement scores: every score is a hypothesis/)).toBeTruthy();
    expect(screen.getByText(/Scores are to be provided/)).toBeTruthy();
  });

  it("shows a recorded score with its hypothesis label", async () => {
    const api = fakeApi({
      scores: vi.fn(async () => ({
        label: "Judgement scores: every score is a hypothesis.",
        criteria: [{ key: "pull", label: "Buyer pull" }],
        scores: [
          {
            offerId: "offer-6",
            criterionKey: "pull",
            score: 4,
            status: "hypothesis" as const,
            rationale: null,
          },
        ],
      })),
    });
    render(<OffersView permissions={["offers.read"]} api={api} />);
    await open();
    expect(screen.getByText(/Buyer pull: 4 \(hypothesis\)/)).toBeTruthy();
  });

  it("shows the acknowledge control only to a holder of offers.limitations.acknowledge, and calls the API", async () => {
    const api = fakeApi();
    const { unmount } = render(<OffersView permissions={["offers.read"]} api={api} />);
    await open();
    expect(screen.queryByRole("button", { name: /Acknowledge limitation/ })).toBeNull();
    unmount();
    render(
      <OffersView permissions={["offers.read", "offers.limitations.acknowledge"]} api={api} />,
    );
    await open();
    fireEvent.click(screen.getByRole("button", { name: /Acknowledge limitation/ }));
    await waitFor(() =>
      expect(api.acknowledge).toHaveBeenCalledWith("offer-6", "lim-1", expect.any(String)),
    );
  });

  it("hides status, capacity and booking controls without their permissions", async () => {
    render(<OffersView permissions={["offers.read"]} api={fakeApi()} />);
    await open();
    expect(screen.queryByRole("button", { name: /Move to/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save limit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record session" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel session" })).toBeNull();
  });

  it("offers the next statuses, needs a note and calls the API with the latest version", async () => {
    const d = detail({ latest: version({ versionNo: 2, status: "draft" }), status: "approved" });
    const api = fakeApi({}, [summary()], d);
    render(<OffersView permissions={ALL} api={api} />);
    await open();
    expect(screen.getByRole("button", { name: "Move to internally reviewed" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move to available" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move to internally reviewed" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/note of at least 3 characters/);
    expect(api.moveStatus).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Note for the status move"), {
      target: { value: "Looks right" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move to internally reviewed" }));
    await waitFor(() =>
      expect(api.moveStatus).toHaveBeenCalledWith(
        "offer-6",
        2,
        "internally_reviewed",
        "Looks right",
        expect.any(String),
      ),
    );
  });

  it.each([
    ["limitation_unacknowledged", /limitation has not been acknowledged/],
    ["placeholder_attributes", /still to be provided/],
    ["uncovered_restricted_phrase", /restricted wording that no approved claim covers/],
    ["invalid_transition", /not allowed from the current status/],
    ["version_superseded", /later version has been approved/],
    ["stale_version", /Reload and try again/],
  ])("shows a plain message for the refusal %s", async (code, message) => {
    const d = detail({ latest: version({ versionNo: 2, status: "internally_reviewed" }) });
    const api = fakeApi(
      {
        moveStatus: vi.fn(async () => {
          throw new CatalogueApiError(409, [code]);
        }),
      },
      [summary()],
      d,
    );
    render(<OffersView permissions={ALL} api={api} />);
    await open();
    fireEvent.change(screen.getByLabelText("Note for the status move"), {
      target: { value: "Go ahead" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move to approved" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
  });

  it("shows the capacity refusal when a booking is refused", async () => {
    const api = fakeApi({
      recordBooking: vi.fn(async () => {
        throw new CatalogueApiError(409, ["capacity_exhausted"]);
      }),
    });
    render(<OffersView permissions={ALL} api={api} />);
    await open();
    fireEvent.change(screen.getByLabelText("Session date"), { target: { value: "2026-11-28" } });
    fireEvent.click(screen.getByRole("button", { name: "Record session" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /This offer is full for that period/,
    );
  });

  it("saves a capacity limit and cancels a booked session through the API", async () => {
    const api = fakeApi();
    render(<OffersView permissions={ALL} api={api} />);
    await open();
    fireEvent.change(screen.getByLabelText("Sessions"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limit" }));
    await waitFor(() =>
      expect(api.setCapacity).toHaveBeenCalledWith(
        "offer-6",
        { periodKind: "month", limitSessions: 5 },
        expect.any(String),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel session" }));
    await waitFor(() =>
      expect(api.updateBooking).toHaveBeenCalledWith(
        "offer-6",
        "b1",
        { state: "cancelled" },
        expect.any(String),
      ),
    );
  });

  it("warns when the note looks like it contains patient information", async () => {
    render(<OffersView permissions={ALL} api={fakeApi()} />);
    await open();
    fireEvent.change(screen.getByLabelText("Note for the status move"), {
      target: { value: "Call 123-45-6789 first" },
    });
    expect(
      within(screen.getByRole("region", { name: "Offer 6" })).getByRole("note").textContent,
    ).toMatch(/Do not enter PHI/);
  });

  it("shows a plain message and not the server text when the list cannot load", async () => {
    const api = fakeApi({
      list: vi.fn(async () => {
        throw new CatalogueApiError(500, []);
      }),
    });
    render(<OffersView permissions={["offers.read"]} api={api} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Something went wrong. Please try again.",
    );
  });
});
