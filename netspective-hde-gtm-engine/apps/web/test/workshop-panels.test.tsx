// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactsPanel } from "../src/app/workshops/[id]/artifacts-panel.js";
import { BriefPanel } from "../src/app/workshops/[id]/brief-panel.js";
import type { Artifact, ArtifactList, Brief } from "../src/lib/workshops-api.js";
import { fakeWorkshopsApi } from "./workshop-fakes.js";

// Task T064: the preparation brief and the artifacts.
afterEach(cleanup);

const brief = (over: Partial<Brief> = {}): Brief => ({
  id: "b1",
  versionNo: 2,
  source: "model",
  model: "model-x",
  promptVersion: "1.0.0",
  confidence: "low",
  rationale: "Little evidence is held.",
  reviewStatus: "unreviewed",
  reviewedBy: null,
  notice: null,
  createdAt: "2026-11-27T10:00:00.000Z",
  content: {
    confirmedFacts: [{ evidenceId: "e1", text: "Delays were recorded." }],
    inferences: [
      {
        statement: "Review may be slow.",
        evidenceIds: ["e2"],
        contradictingEvidenceIds: ["e3"],
        basis: "One interpretation.",
      },
    ],
    contradictions: [{ evidenceId: "e3", text: "One sender was quick." }],
    unknowns: ["How long review takes."],
    suggestedQuestions: ["Who reviews?"],
    artifactChecklist: [{ kind: "scrubbed_rejection_log", why: "To see repeats." }],
  },
  ...over,
});

describe("the brief panel", () => {
  it("keeps facts, inferences and contradictions apart, with the confidence", async () => {
    const api = fakeWorkshopsApi({
      brief: vi.fn().mockResolvedValue({ latest: brief(), earlier: [brief({ id: "b0" })] }),
    });
    render(<BriefPanel workshop={{ id: "w1", state: "booked" }} api={api} canEdit />);
    const facts = await screen.findByRole("list", { name: "Confirmed facts" });
    expect(facts.textContent).toBe("Delays were recorded.");
    expect(screen.getByRole("list", { name: "Inferences (not facts)" }).textContent).toContain(
      "Review may be slow.",
    );
    expect(screen.getByRole("list", { name: "Contradicting evidence" }).textContent).toContain(
      "One sender was quick.",
    );
    expect(screen.getByText(/confidence low/).textContent).toContain("1 earlier version");
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(api.reviewBrief).toHaveBeenCalledWith("w1", "b1"));
  });
  it("makes a brief and shows why the model was not used", async () => {
    const api = fakeWorkshopsApi({
      generateBrief: vi.fn().mockResolvedValue({ notice: "The model is switched off." }),
    });
    render(<BriefPanel workshop={{ id: "w1", state: "requested" }} api={api} canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "Make a brief" }));
    expect(await screen.findByText("The model is switched off.")).toBeTruthy();
  });
  it("offers no brief for a cancelled workshop or without the permission", async () => {
    render(
      <BriefPanel workshop={{ id: "w1", state: "cancelled" }} api={fakeWorkshopsApi()} canEdit />,
    );
    expect(await screen.findByText("No brief yet.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

const artifact = (over: Partial<Artifact> = {}): Artifact => ({
  id: "ar1",
  kind: "scrubbed_rejection_log",
  title: "Rejection log",
  reference: null,
  suppliedBy: null,
  hasContent: false,
  state: "held",
  holdRuleIds: ["PHI.SSN"],
  recordedAt: "2026-11-27T10:00:00.000Z",
  ...over,
});
const list = (items: Artifact[] = []): ArtifactList => ({
  checklist: [
    { kind: "specification", label: "Specification", status: "not_received" },
    { kind: "scrubbed_rejection_log", label: "Scrubbed rejection log", status: "held" },
  ],
  items,
});

describe("the artifacts panel", () => {
  it("shows the checklist and says only text files are kept", async () => {
    render(
      <ArtifactsPanel
        workshopId="w1"
        api={fakeWorkshopsApi({ artifacts: vi.fn().mockResolvedValue(list()) })}
        canEdit
        canReview={false}
      />,
    );
    expect(await screen.findByText("Specification: not received")).toBeTruthy();
    expect(screen.getByText("Scrubbed rejection log: held for review")).toBeTruthy();
    expect(screen.getByText(/Only text files/)).toBeTruthy();
    expect(screen.getByLabelText("Text file").getAttribute("accept")).toBe(
      ".txt,.md,.csv,.json,.log",
    );
  });
  it("records a reference and says plainly when a file is held", async () => {
    const api = fakeWorkshopsApi({
      artifacts: vi.fn().mockResolvedValue(list()),
      recordArtifact: vi.fn().mockResolvedValue(artifact()),
    });
    render(<ArtifactsPanel workshopId="w1" api={api} canEdit canReview={false} />);
    const form = await screen.findByRole("form", { name: "Record an artifact" });
    await screen.findByRole("option", { name: "Specification" });
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "Interface spec" } });
    fireEvent.change(within(form).getByLabelText(/^Reference/), {
      target: { value: "Shared drive" },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(api.recordArtifact).toHaveBeenCalledWith("w1", {
        kind: "specification",
        title: "Interface spec",
        reference: "Shared drive",
      }),
    );
    expect((await screen.findByRole("status")).textContent).toContain("held for review");
  });
  it("sends a chosen text file with its name, warning about patient-like text", async () => {
    const api = fakeWorkshopsApi({
      artifacts: vi.fn().mockResolvedValue(list()),
      recordArtifact: vi.fn().mockResolvedValue(artifact({ state: "received" })),
    });
    render(<ArtifactsPanel workshopId="w1" api={api} canEdit canReview={false} />);
    const form = await screen.findByRole("form", { name: "Record an artifact" });
    await screen.findByRole("option", { name: "Specification" });
    const text = "SSN 000-12-3456";
    const file = new File([text], "log.txt", { type: "text/plain" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
    fireEvent.change(within(form).getByLabelText("Text file"), { target: { files: [file] } });
    expect(await within(form).findByRole("note")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Title"), { target: { value: "A log" } });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(api.recordArtifact).toHaveBeenCalledWith(
        "w1",
        expect.objectContaining({ content: text, fileName: "log.txt" }),
      ),
    );
  });
  it("lets only a quarantine reviewer release or discard, with a reason", async () => {
    const api = fakeWorkshopsApi({ artifacts: vi.fn().mockResolvedValue(list([artifact()])) });
    const { rerender } = render(
      <ArtifactsPanel workshopId="w1" api={api} canEdit canReview={false} />,
    );
    await screen.findByText(/Rejection log \(scrubbed rejection log\)/);
    expect(screen.queryByRole("button", { name: /Discard/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
    rerender(<ArtifactsPanel workshopId="w1" api={api} canEdit canReview />);
    const discard = screen.getByRole("button", {
      name: "Discard Rejection log",
    }) as HTMLButtonElement;
    expect(discard.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason for the decision/), {
      target: { value: "Holds patient data" },
    });
    fireEvent.click(discard);
    await waitFor(() =>
      expect(api.decideArtifact).toHaveBeenCalledWith("ar1", {
        decision: "discard",
        reason: "Holds patient data",
      }),
    );
  });
});
