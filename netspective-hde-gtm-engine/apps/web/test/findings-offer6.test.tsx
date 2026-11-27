// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FindingsOffer6 } from "../src/app/workshops/[id]/findings-offer6.js";
import { DIMENSIONS, type FindingsView, type Offer6Content } from "../src/lib/workshops-api.js";
import { fakeWorkshopsApi } from "./workshop-fakes.js";

// Task T066: the Offer 6 findings editor: unknown, gap and not recorded stay apart.
afterEach(cleanup);

const names = Array.from({ length: 10 }, (_, i) => `field_${i + 1}`);
const content: Offer6Content = {
  fields: names.map((name) => ({
    intakeName: name,
    name,
    renameReason: "",
    sourceSystem: "",
    sourceInterface: "",
    observations: Object.fromEntries(
      DIMENSIONS.map((d) => [d, { status: null, note: "" }]),
    ) as Offer6Content["fields"][number]["observations"],
  })),
  overall: { view: null, dependsOnUnknowns: [], reason: "" },
  disclaimer: "It is not a guarantee of model performance.",
  inputAuditScope: { useCase: "", sources: [] },
};
const view: FindingsView = { current: null, versions: [], shortfalls: [], template: content };
const api = () => fakeWorkshopsApi({ findings: vi.fn().mockResolvedValue(view) });
const show = (client = api()) => {
  render(<FindingsOffer6 workshopId="w1" api={client} canEdit onChanged={async () => {}} />);
  return client;
};
const set = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const summaryText = () => screen.getByLabelText("Observation summary").textContent;

describe("Offer 6 findings", () => {
  it("lists the ten fields, each observation starting as not recorded", async () => {
    show();
    expect(await screen.findByRole("group", { name: "field_10" })).toBeTruthy();
    const select = screen.getByLabelText("field_1 quality") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Not recorded", "Known good", "Gap", "Unknown"]);
    expect(summaryText()).toContain("Not recorded: 50");
    expect(screen.getByText("It is not a guarantee of model performance.")).toBeTruthy();
  });

  it("counts unknown separately from gap", async () => {
    show();
    await screen.findByRole("group", { name: "field_1" });
    set("field_1 quality", "unknown");
    set("field_2 access", "gap");
    expect(summaryText()).toContain("Gap: 1 · Unknown: 1 · Not recorded: 48");
  });

  it("saves the view, the unknowns it depends on and a scope of at most two sources", async () => {
    const client = show();
    await screen.findByRole("group", { name: "field_1" });
    set("field_1 quality", "unknown");
    set("View", "conditional");
    fireEvent.click(screen.getByLabelText(/Depends on field_1 quality/));
    set("One use case", "Readmission pilot");
    set("Source 1", "Clinical system");
    expect(screen.queryByLabelText(/Source 3/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(client.saveFindings).toHaveBeenCalled());
    const saved = vi.mocked(client.saveFindings).mock.calls[0]![1].content as Offer6Content;
    expect(saved.overall).toMatchObject({
      view: "conditional",
      dependsOnUnknowns: [{ field: "field_1", dimension: "quality" }],
    });
    expect(saved.inputAuditScope).toEqual({
      useCase: "Readmission pilot",
      sources: ["Clinical system"],
    });
    expect(saved.fields).toHaveLength(10);
  });

  it("drops a listed dependency once it is no longer unknown", async () => {
    const client = show();
    await screen.findByRole("group", { name: "field_1" });
    set("field_1 quality", "unknown");
    fireEvent.click(screen.getByLabelText(/Depends on field_1 quality/));
    set("field_1 quality", "known_good");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(client.saveFindings).toHaveBeenCalled());
    const saved = vi.mocked(client.saveFindings).mock.calls[0]![1].content as Offer6Content;
    expect(saved.overall.dependsOnUnknowns).toEqual([]);
  });

  it("asks why a field name changed", async () => {
    show();
    await screen.findByRole("group", { name: "field_1" });
    expect(screen.queryByLabelText("Why the name of field_1 changed")).toBeNull();
    set("Name for field_1", "field_one");
    expect(screen.getByLabelText("Why the name of field_1 changed")).toBeTruthy();
  });

  it("applies a suggested status only when ticked", async () => {
    const client = fakeWorkshopsApi({
      findings: vi.fn().mockResolvedValue(view),
      suggest: vi.fn().mockResolvedValue({
        confidence: "low",
        rationale: "From the notes.",
        dropped: 0,
        notice: null,
        items: [
          {
            path: "fields.0.observations.completeness.status",
            value: "known_good",
            supportingText: "completeness is known good",
            interpretation: true,
          },
        ],
      }),
    });
    show(client);
    await screen.findByRole("group", { name: "field_1" });
    set(/^Session notes/, "Its completeness is known good, they said.");
    fireEvent.click(screen.getByRole("button", { name: "Suggest from my notes" }));
    const tick = await screen.findByLabelText(/Apply field_1 completeness: known good/);
    const select = screen.getByLabelText("field_1 completeness") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.click(tick);
    expect(select.value).toBe("known_good");
    expect(client.saveFindings).not.toHaveBeenCalled();
  });
});
