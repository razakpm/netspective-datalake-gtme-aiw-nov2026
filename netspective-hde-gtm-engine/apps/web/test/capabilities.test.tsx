// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilitiesView } from "../src/app/capabilities/capabilities-view.js";
import { CatalogueApiError } from "../src/lib/catalogue-http.js";
import type {
  Capability,
  CapabilitiesApi,
  CapabilitySummary,
} from "../src/lib/capabilities-api.js";

afterEach(cleanup);

const ALL_PLACEHOLDERS = [
  "name",
  "description",
  "inputTypes",
  "outputTypes",
  "buyerProblems",
  "limitations",
  "requiredExpertise",
  "potentialPaidTypeKey",
];
const summary = (slot: number, over: Partial<CapabilitySummary> = {}): CapabilitySummary => ({
  id: `capability-${String(slot).padStart(2, "0")}`,
  slot,
  lockNo: 1,
  name: null,
  publicClaimStatus: "not_approved",
  publicClaimNeedsReview: false,
  placeholderAttributes: ALL_PLACEHOLDERS,
  ...over,
});
const detail = (over: Partial<Capability> = {}): Capability => ({
  ...summary(1),
  attributes: {
    name: null,
    description: null,
    inputTypes: null,
    outputTypes: null,
    buyerProblems: null,
    limitations: null,
    requiredExpertise: null,
    potentialPaidTypeKey: null,
  },
  evidence: [],
  offers: [],
  publicClaimId: null,
  ...over,
});
function fakeApi(
  items: CapabilitySummary[],
  d: Capability,
  over: Partial<CapabilitiesApi> = {},
): CapabilitiesApi {
  return {
    list: vi.fn(async () => ({ items })),
    get: vi.fn(async () => d),
    setPublicStatus: vi.fn(async () => d),
    ...over,
  };
}
const open = async (slot = 1) => {
  fireEvent.click(await screen.findByRole("button", { name: `Open capability ${slot}` }));
  await screen.findByRole("region", { name: `Capability ${slot}` });
};

describe("the capability list", () => {
  it("shows the slots with placeholders marked and the public claim status", async () => {
    const items = [
      summary(1),
      summary(2, {
        name: "CCDA mapping",
        placeholderAttributes: ["description"],
        publicClaimStatus: "approved",
      }),
    ];
    render(<CapabilitiesView permissions={["capabilities.read"]} api={fakeApi(items, detail())} />);
    expect(await screen.findByText(/Capability 1: To be provided/)).toBeTruthy();
    expect(screen.getByText(/Capability 2: CCDA mapping/)).toBeTruthy();
    expect(screen.getByText("8 details to be provided.")).toBeTruthy();
    expect(screen.getByText("1 details to be provided.")).toBeTruthy();
    expect(screen.getByText("Approved for public claims.")).toBeTruthy();
    expect(screen.getAllByText("Not approved for public claims.").length).toBe(1);
  });

  it("flags a capability whose public claim needs review", async () => {
    render(
      <CapabilitiesView
        permissions={["capabilities.read"]}
        api={fakeApi(
          [summary(1, { publicClaimStatus: "approved", publicClaimNeedsReview: true })],
          detail(),
        )}
      />,
    );
    expect((await screen.findByRole("note")).textContent).toMatch(/public claim needs review/);
  });
});

describe("a capability", () => {
  it("shows every attribute, with to be provided for the missing ones, and reaches status and limitations in one interaction", async () => {
    const d = detail({
      attributes: {
        ...detail().attributes,
        limitations: ["Needs samples"],
        description: "Maps documents",
      },
      evidence: [{ id: "e1", basisKind: "delivery_record", reference: "rec-1", note: null }],
      offers: [{ offerId: "offer-1", name: "Sender Onboarding Friction Map" }],
    });
    render(<CapabilitiesView permissions={["capabilities.read"]} api={fakeApi([summary(1)], d)} />);
    await open();
    expect(screen.getByText("Maps documents")).toBeTruthy();
    expect(screen.getByText("Needs samples")).toBeTruthy();
    expect(screen.getAllByText("To be provided").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText(/delivery record: rec-1/)).toBeTruthy();
    expect(screen.getByText("Sender Onboarding Friction Map")).toBeTruthy();
    expect(screen.getByText("Not approved for public claims.", { selector: "p" })).toBeTruthy();
  });

  it("says when no evidence basis or offer is recorded", async () => {
    render(
      <CapabilitiesView
        permissions={["capabilities.read"]}
        api={fakeApi([summary(1)], detail())}
      />,
    );
    await open();
    expect(screen.getByText("No evidence basis recorded.")).toBeTruthy();
    expect(screen.getByText("No offers linked.")).toBeTruthy();
  });

  it("shows internal delivery examples only with capabilities.examples.read, and labels them internal", async () => {
    const d = detail({
      deliveryExamples: [
        { id: "x1", text: "An internal delivery note", addedAt: "2026-11-19T00:00:00.000Z" },
      ],
    });
    const { unmount } = render(
      <CapabilitiesView permissions={["capabilities.read"]} api={fakeApi([summary(1)], d)} />,
    );
    await open();
    expect(screen.queryByText("An internal delivery note")).toBeNull();
    unmount();
    render(
      <CapabilitiesView
        permissions={["capabilities.read", "capabilities.examples.read"]}
        api={fakeApi([summary(1)], d)}
      />,
    );
    await open();
    expect(screen.getByText("An internal delivery note")).toBeTruthy();
    expect(screen.getByText(/Internal delivery examples \(internal only\)/)).toBeTruthy();
  });

  it("shows the public approval control only to a holder of claims.approve and calls the API with the claim id", async () => {
    const api = fakeApi([summary(1)], detail());
    const { unmount } = render(<CapabilitiesView permissions={["capabilities.read"]} api={api} />);
    await open();
    expect(screen.queryByRole("button", { name: "Approve for public claims" })).toBeNull();
    unmount();
    render(<CapabilitiesView permissions={["capabilities.read", "claims.approve"]} api={api} />);
    await open();
    const button = screen.getByRole("button", {
      name: "Approve for public claims",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Approved claim id"), { target: { value: "claim-1" } });
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.setPublicStatus).toHaveBeenCalledWith(
        "capability-01",
        { status: "approved", claimId: "claim-1" },
        expect.any(String),
      ),
    );
  });

  it("offers to withdraw an approved capability and warns when its claim needs review", async () => {
    const d = detail({
      publicClaimStatus: "approved",
      publicClaimNeedsReview: true,
      publicClaimId: "claim-1",
    });
    const api = fakeApi(
      [summary(1, { publicClaimStatus: "approved", publicClaimNeedsReview: true })],
      d,
    );
    render(<CapabilitiesView permissions={["capabilities.read", "claims.approve"]} api={api} />);
    await open();
    expect(screen.getAllByText(/public claim needs review/).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw public approval" }));
    await waitFor(() =>
      expect(api.setPublicStatus).toHaveBeenCalledWith(
        "capability-01",
        { status: "not_approved" },
        expect.any(String),
      ),
    );
  });

  it.each([
    ["placeholder_attributes", /still to be provided/],
    ["no_evidence_basis", /Record an evidence basis/],
    ["claim_not_approved", /approved claim with valid evidence is required/],
  ])("shows a plain message for the refusal %s", async (code, message) => {
    const api = fakeApi([summary(1)], detail(), {
      setPublicStatus: vi.fn(async () => {
        throw new CatalogueApiError(409, [code]);
      }),
    });
    render(<CapabilitiesView permissions={["capabilities.read", "claims.approve"]} api={api} />);
    await open();
    fireEvent.change(screen.getByLabelText("Approved claim id"), { target: { value: "claim-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve for public claims" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
  });
});
