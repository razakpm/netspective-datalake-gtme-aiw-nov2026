// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkshopWorkspace } from "../src/app/workshops/[id]/workshop-workspace.js";
import { CatalogueApiError } from "../src/lib/catalogue-http.js";
import type { WorkshopsApi } from "../src/lib/workshops-api.js";
import { fakeWorkshopsApi, workshop } from "./workshop-fakes.js";

// Task T063: intake, participants, booking and state, capacity and effort.
afterEach(cleanup);
const READ = ["workshops.read"];
const EDIT = ["workshops.read", "workshops.edit"];

const show = (api: WorkshopsApi, permissions: string[] = EDIT) =>
  render(<WorkshopWorkspace id="w1" permissions={permissions} api={api} />);
const form = () => screen.findByRole("form", { name: "Booking and state" });

describe("the workspace", () => {
  it("shows the intake, state, capacity and history", async () => {
    show(fakeWorkshopsApi(), READ);
    expect(await screen.findByRole("heading", { level: 1, name: /Northvale HIE/ })).toBeTruthy();
    expect(screen.getByText("Integration lead")).toBeTruthy();
    expect(screen.getByText("1 of 3 sessions used this week.")).toBeTruthy();
    expect(screen.getByText(/Findings can be recorded once/)).toBeTruthy();
  });

  it("offers no control without the edit permission", async () => {
    show(fakeWorkshopsApi(), READ);
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("books by hand or through the calendar with the chosen time", async () => {
    const api = fakeWorkshopsApi();
    show(api);
    const booking = await form();
    const book = within(booking).getByRole("button", { name: "Book" }) as HTMLButtonElement;
    expect(book.disabled).toBe(true);
    fireEvent.change(within(booking).getByLabelText("Date and time"), {
      target: { value: "2026-12-01T10:00" },
    });
    fireEvent.change(within(booking).getByLabelText("Book through"), {
      target: { value: "calendar" },
    });
    fireEvent.click(book);
    await waitFor(() =>
      expect(api.transition).toHaveBeenCalledWith("w1", {
        action: "book",
        lockNo: 1,
        scheduledAt: new Date("2026-12-01T10:00").toISOString(),
        via: "calendar",
      }),
    );
  });

  it("needs a reason to cancel and shows only the moves the state allows", async () => {
    const api = fakeWorkshopsApi({
      get: vi.fn().mockResolvedValue(workshop({ state: "booked", lockNo: 2 })),
    });
    show(api);
    const booking = await form();
    expect(
      within(booking)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Mark held", "Reschedule", "Record no-show", "Cancel workshop"]);
    const cancel = within(booking).getByRole("button", {
      name: "Cancel workshop",
    }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.change(within(booking).getByLabelText(/^Reason/), {
      target: { value: "buyer asked" },
    });
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(api.transition).toHaveBeenCalledWith("w1", {
        action: "cancel",
        lockNo: 2,
        note: "buyer asked",
      }),
    );
  });

  it("explains a full offer with the wait-list, and shows notices", async () => {
    const api = fakeWorkshopsApi({
      get: vi.fn().mockResolvedValue(
        workshop({
          capacity: { state: "exhausted", periodKind: "month", limit: 3, used: 3 },
          notices: ["account_suppressed"],
        }),
      ),
      transition: vi.fn().mockRejectedValue(new CatalogueApiError(409, ["capacity_exhausted"])),
    });
    show(api);
    const link = await screen.findByRole("link", { name: "account workspace" });
    expect(link.getAttribute("href")).toBe("/accounts/a1/workspace");
    expect(screen.getByText(/add the account to the wait-list/)).toBeTruthy();
    expect(screen.getByText(/This account is suppressed/)).toBeTruthy();
    const booking = await form();
    fireEvent.change(within(booking).getByLabelText("Date and time"), {
      target: { value: "2026-12-01T10:00" },
    });
    fireEvent.click(within(booking).getByRole("button", { name: "Book" }));
    expect((await screen.findByRole("alert")).textContent).toContain("full for that period");
  });

  it("says when no limit is set", async () => {
    show(
      fakeWorkshopsApi({
        get: vi.fn().mockResolvedValue(
          workshop({
            capacity: { state: "no_limit_set", periodKind: null, limit: null, used: 0 },
          }),
        ),
      }),
    );
    expect(await screen.findByText("No limit is set for this offer.")).toBeTruthy();
  });

  it("adds a participant by name and role and records effort", async () => {
    const api = fakeWorkshopsApi();
    show(api);
    const add = await screen.findByRole("form", { name: "Add a participant" });
    fireEvent.change(within(add).getByLabelText(/^Name/), {
      target: { value: "Integration Lead" },
    });
    fireEvent.click(within(add).getByRole("button", { name: "Add participant" }));
    await waitFor(() =>
      expect(api.addParticipant).toHaveBeenCalledWith("w1", {
        side: "buyer",
        displayName: "Integration Lead",
      }),
    );
    const effort = screen.getByRole("form", { name: "Record effort" });
    for (const [label, value] of [
      ["Preparation hours", "2.5"],
      ["Session hours", "1"],
      ["People", "2"],
    ]) {
      fireEvent.change(within(effort).getByLabelText(label!), { target: { value } });
    }
    fireEvent.submit(effort);
    await waitFor(() =>
      expect(api.recordEffort).toHaveBeenCalledWith("w1", {
        prepHours: 2.5,
        sessionHours: 1,
        people: 2,
      }),
    );
  });

  it("shows the findings and the page once the session has been held", async () => {
    show(
      fakeWorkshopsApi({
        get: vi.fn().mockResolvedValue(workshop({ state: "held" })),
      }),
    );
    expect(await screen.findByRole("heading", { name: "Findings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "One-page output" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Booking and state" })).toBeNull();
  });
});
