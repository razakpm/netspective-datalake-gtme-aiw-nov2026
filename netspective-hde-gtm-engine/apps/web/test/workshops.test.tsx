// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkshopsView } from "../src/app/workshops/workshops-view.js";
import { CatalogueApiError } from "../src/lib/catalogue-http.js";
import { fakeWorkshopsApi, summary } from "./workshop-fakes.js";

// Task T062: the workshop list.
afterEach(cleanup);

describe("the workshop list", () => {
  it("lists workshops with their offer and state, linking to the workspace", async () => {
    const api = fakeWorkshopsApi({
      list: vi.fn().mockResolvedValue({ items: [summary({ state: "booked" })] }),
    });
    render(<WorkshopsView api={api} />);
    const link = await screen.findByRole("link", { name: /Northvale HIE · Offer 1/ });
    expect(link.getAttribute("href")).toBe("/workshops/w1");
    expect(screen.getByText("Booked", { selector: "span" })).toBeTruthy();
  });
  it("filters by state and offer and says when nothing matches", async () => {
    const api = fakeWorkshopsApi({ list: vi.fn().mockResolvedValue({ items: [] }) });
    render(<WorkshopsView api={api} />);
    expect(await screen.findByText("No workshops match.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "held" } });
    fireEvent.change(screen.getByLabelText("Offer"), { target: { value: "offer-6" } });
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({ state: "held", offerId: "offer-6" }),
    );
  });
  it("shows effort per offer beside the estimate, with missing effort as missing", async () => {
    const api = fakeWorkshopsApi({
      effortSummary: vi.fn().mockResolvedValue({
        items: [
          {
            offerId: "offer-1",
            offerKey: "sender-onboarding-friction-map",
            workshops: 3,
            withEffort: 2,
            missing: 1,
            totalPrepHours: 6,
            totalSessionHours: 2,
            averagePrepHours: 3,
            averageSessionHours: 1,
            averagePeople: 2,
            estimate: "About two days",
          },
          {
            offerId: "offer-6",
            offerKey: "pilot-input-trace-workshop",
            workshops: 0,
            withEffort: 0,
            missing: 0,
            totalPrepHours: 0,
            totalSessionHours: 0,
            averagePrepHours: null,
            averageSessionHours: null,
            averagePeople: null,
            estimate: null,
          },
        ],
      }),
    });
    render(<WorkshopsView api={api} />);
    const one = await screen.findByRole("article", { name: /Offer 1/ });
    expect(one.textContent).toContain("2 of 3 workshop(s) with effort recorded; 1 missing.");
    expect(one.textContent).toContain("Estimate (a hypothesis): About two days");
    expect(screen.getByRole("article", { name: /Offer 6/ }).textContent).toContain(
      "preparation not recorded",
    );
  });
  it("shows a plain message for a refusal", async () => {
    const api = fakeWorkshopsApi({
      list: vi.fn().mockRejectedValue(new CatalogueApiError(403, ["forbidden"])),
    });
    render(<WorkshopsView api={api} />);
    expect((await screen.findByRole("alert")).textContent).toContain("permission");
  });
});
