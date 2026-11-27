// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputPanel } from "../src/app/workshops/[id]/output-panel.js";
import { CatalogueApiError } from "../src/lib/catalogue-http.js";
import type { Output, WorkshopsApi } from "../src/lib/workshops-api.js";
import { fakeWorkshopsApi } from "./workshop-fakes.js";

// Task T067: the one-page output.
afterEach(cleanup);

const output = (over: Partial<Output> = {}): Output => ({
  id: "o1",
  revisionNo: 1,
  state: "draft",
  findingVersionNo: 1,
  approvedBy: null,
  outOfDate: false,
  problems: [],
  sections: {
    title: "Workshop findings",
    organisation: "Northvale HIE",
    offerName: "Friction Map",
    date: "2026-11-24",
    summary: "A summary.",
    findings: "1. Reviews wait.",
    unknowns: "Unknown: repeat rate.",
    nextStep: "Collect logs.",
    inScope: ["Delays"],
    outOfScope: ["Fixes"],
  },
  ...over,
});
const api = (latest: Output | null, over: Partial<WorkshopsApi> = {}) =>
  fakeWorkshopsApi({
    output: vi.fn().mockResolvedValue({ latest, revisions: [], shares: [] }),
    ...over,
  });
const show = (client: WorkshopsApi, canEdit = true, canApprove = false) =>
  render(<OutputPanel workshopId="w1" api={client} canEdit={canEdit} canApprove={canApprove} />);
const approve = () => screen.queryByRole("button", { name: "Approve and make the PDF" });

describe("the output panel", () => {
  it("previews the page and edits only the parts a person may change", async () => {
    const client = api(output());
    show(client);
    const form = await screen.findByRole("form", { name: "Edit the page" });
    expect(within(form).getAllByRole("textbox")).toHaveLength(5);
    expect(within(form).queryByLabelText(/Findings|Unknowns/)).toBeNull();
    expect(screen.getByRole("article", { name: "Preview" }).textContent).toContain(
      "Unknown: repeat rate.",
    );
    fireEvent.change(within(form).getByLabelText("Summary"), { target: { value: "Shorter." } });
    fireEvent.click(within(form).getByRole("button", { name: "Save as a new revision" }));
    await waitFor(() =>
      expect(client.editOutput).toHaveBeenCalledWith("w1", {
        baseRevisionNo: 1,
        sections: {
          title: "Workshop findings",
          summary: "Shorter.",
          nextStep: "Collect logs.",
          inScope: ["Delays"],
          outOfScope: ["Fixes"],
        },
      }),
    );
  });

  it("will not save an empty scope section", async () => {
    show(api(output()));
    const form = await screen.findByRole("form", { name: "Edit the page" });
    fireEvent.change(within(form).getByLabelText(/^Out of scope/), { target: { value: " " } });
    expect(
      (within(form).getByRole("button", { name: /Save as/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows approval only with the approval permission, and blocks it while problems remain", async () => {
    show(api(output()));
    await screen.findByRole("article", { name: "Preview" });
    expect(approve()).toBeNull();
    cleanup();
    show(api(output({ problems: [{ code: "price_stated", message: "No price." }] })), true, true);
    expect((await screen.findByRole("list", { name: "Before approval" })).textContent).toBe(
      "No price.",
    );
    expect((approve() as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const client = api(output());
    show(client, true, true);
    await screen.findByRole("article", { name: "Preview" });
    fireEvent.click(approve()!);
    await waitFor(() => expect(client.approveOutput).toHaveBeenCalledWith("w1"));
  });

  it("offers the PDF and records sharing only for an approved page, sending nothing", async () => {
    show(api(output()));
    await screen.findByRole("article", { name: "Preview" });
    expect(screen.queryByRole("link", { name: "Download the PDF" })).toBeNull();
    cleanup();
    const client = api(output({ state: "approved" }));
    show(client);
    expect(
      (await screen.findByRole("link", { name: "Download the PDF" })).getAttribute("href"),
    ).toBe("/api/v1/workshops/w1/output/pdf");
    expect(screen.getByText(/Nothing is sent from here/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record sharing" }));
    await waitFor(() =>
      expect(client.shareOutput).toHaveBeenCalledWith("w1", { how: "handed_over" }),
    );
  });

  it("marks a page out of date and offers nothing but a new draft", async () => {
    show(api(output({ state: "approved", outOfDate: true })), true, true);
    expect(await screen.findByText(/^Out of date/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download the PDF" })).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
    expect(approve()).toBeNull();
    expect(screen.getByRole("button", { name: "Make a new draft from the findings" })).toBeTruthy();
  });

  it("shows a plain message when the findings are not ready", async () => {
    const client = api(null, {
      generateOutput: vi.fn().mockRejectedValue(new CatalogueApiError(409, ["output_not_ready"])),
    });
    show(client);
    fireEvent.click(await screen.findByRole("button", { name: "Make a draft" }));
    expect((await screen.findByRole("alert")).textContent).toContain("finalised findings");
  });
});
