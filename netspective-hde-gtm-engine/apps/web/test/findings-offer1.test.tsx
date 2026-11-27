// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindingsOffer1 } from "../src/app/workshops/[id]/findings-offer1.js";
import { CatalogueApiError } from "../src/lib/catalogue-http.js";
import type {
  Finding,
  FindingsView,
  Offer1Content,
  WorkshopsApi,
} from "../src/lib/workshops-api.js";
import { fakeWorkshopsApi } from "./workshop-fakes.js";

// Task T065: the Offer 1 findings editor.
afterEach(cleanup);

const template: Offer1Content = {
  flowSummary: "",
  delaySources: [],
  unknowns: [],
  suggestedNextStep: "",
  boundaryNote: "This free diagnosis covers where the delay is.",
};
const view = (over: Partial<FindingsView> = {}): FindingsView => ({
  current: null,
  versions: [],
  shortfalls: [
    { code: "too_few_delay_sources", waivable: true, message: "Three delay sources are expected." },
  ],
  template,
  ...over,
});
const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "f1",
  versionNo: 1,
  kind: "offer_1",
  state: "draft",
  content: template,
  lockNo: 3,
  waiverReason: null,
  correctionReason: null,
  ...over,
});
const show = (api: WorkshopsApi, canEdit = true) =>
  render(<FindingsOffer1 workshopId="w1" api={api} canEdit={canEdit} onChanged={async () => {}} />);
const source = (n: number) => screen.getByRole("group", { name: `Delay source ${n}` });
const type = (label: string | RegExp, value: string, scope: HTMLElement = document.body) =>
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });

describe("Offer 1 findings", () => {
  it("shows three delay sources and what is still needed", async () => {
    show(fakeWorkshopsApi({ findings: vi.fn().mockResolvedValue(view()) }));
    expect(await screen.findByRole("group", { name: "Delay source 3" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Still needed" }).textContent).toContain(
      "can be finalised with a reason",
    );
    expect(screen.getByText(/economic buyer and funding path are left/)).toBeTruthy();
  });

  it("saves only what was entered and never assumes a unit", async () => {
    const api = fakeWorkshopsApi({ findings: vi.fn().mockResolvedValue(view()) });
    show(api);
    await screen.findByRole("group", { name: "Delay source 1" });
    type("Description", "Reviews wait", source(1));
    type("Who can act on it", "operator", source(1));
    type("Delay", "quantified", source(1));
    type("Amount", "2", source(1));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.saveFindings).toHaveBeenCalled());
    const body = vi.mocked(api.saveFindings).mock.calls[0]![1];
    expect((body.content as Offer1Content).delaySources).toEqual([
      { description: "Reviews wait", ownerClass: "operator", delay: null, confirmation: "unknown" },
    ]);
    expect(body).not.toHaveProperty("lockNo");
  });

  it("finalises a saved draft, with a reason for a shortfall", async () => {
    const api = fakeWorkshopsApi({
      findings: vi.fn().mockResolvedValue(view({ current: finding(), versions: [finding()] })),
    });
    show(api);
    const finalise = await screen.findByRole("button", { name: "Finalise" });
    type(/Reason for finalising/, "Only two came up in the session");
    fireEvent.click(finalise);
    await waitFor(() =>
      expect(api.finalise).toHaveBeenCalledWith("w1", {
        waiverReason: "Only two came up in the session",
      }),
    );
  });

  it("will not finalise unsaved changes", async () => {
    show(fakeWorkshopsApi({ findings: vi.fn().mockResolvedValue(view({ current: finding() })) }));
    await screen.findByRole("button", { name: "Finalise" });
    type("Onboarding flow summary", "A change");
    expect((screen.getByRole("button", { name: "Finalise" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("saves a change to finalised findings only as a correction with a reason", async () => {
    const api = fakeWorkshopsApi({
      findings: vi
        .fn()
        .mockResolvedValue(view({ current: finding({ state: "finalised" }), shortfalls: [] })),
    });
    show(api);
    const save = (await screen.findByRole("button", {
      name: "Save as a correction",
    })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Finalise" })).toBeNull();
    type("Reason for the correction", "The flow was wrong");
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.saveFindings).toHaveBeenCalledWith(
        "w1",
        expect.objectContaining({ lockNo: 3, correctionReason: "The flow was wrong" }),
      ),
    );
  });

  it("fills plain suggestions without saving and applies an interpretation only when ticked", async () => {
    const api = fakeWorkshopsApi({
      findings: vi.fn().mockResolvedValue(view()),
      suggest: vi.fn().mockResolvedValue({
        confidence: "medium",
        rationale: "From the notes.",
        dropped: 0,
        notice: null,
        items: [
          {
            path: "delaySources.0.description",
            value: "Messages wait for review",
            supportingText: "messages wait for review",
            interpretation: false,
          },
          {
            path: "delaySources.0.ownerClass",
            value: "operator",
            supportingText: "the exchange team does it",
            interpretation: true,
          },
        ],
      }),
    });
    show(api);
    await screen.findByRole("group", { name: "Delay source 1" });
    type(/^Session notes/, "In the session messages wait for review.");
    fireEvent.click(screen.getByRole("button", { name: "Suggest from my notes" }));
    expect(await screen.findByText("messages wait for review", { selector: "q" })).toBeTruthy();
    const description = within(source(1)).getByLabelText("Description") as HTMLTextAreaElement;
    const owner = within(source(1)).getByLabelText("Who can act on it") as HTMLSelectElement;
    await waitFor(() => expect(description.value).toBe("Messages wait for review"));
    expect(owner.value).toBe("");
    fireEvent.click(screen.getByLabelText(/Apply delay source 1 who can act: operator/));
    expect(owner.value).toBe("operator");
    expect(api.saveFindings).not.toHaveBeenCalled();
  });

  it("shows a plain message when a save is refused", async () => {
    const api = fakeWorkshopsApi({
      findings: vi.fn().mockResolvedValue(view()),
      saveFindings: vi.fn().mockRejectedValue(new CatalogueApiError(422, ["price_stated"])),
    });
    show(api);
    fireEvent.click(await screen.findByRole("button", { name: "Save draft" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Do not state a price");
  });

  it("gives a reader no controls", async () => {
    show(fakeWorkshopsApi({ findings: vi.fn().mockResolvedValue(view()) }), false);
    await screen.findByRole("group", { name: "Delay source 1" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText(/^Session notes/)).toBeNull();
  });
});
