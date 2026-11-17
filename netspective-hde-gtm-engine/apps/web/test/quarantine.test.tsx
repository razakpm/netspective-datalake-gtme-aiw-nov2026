// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuarantineReview } from "../src/app/admin/quarantine/quarantine-review.js";
import { looksLikePhi, PhiWarning } from "../src/components/phi-warning.js";
import { visibleNavItems } from "../src/components/nav.js";
import type { QuarantineApi, QuarantineItemView } from "../src/lib/quarantine-api.js";

afterEach(cleanup);

const item = (over: Partial<QuarantineItemView> = {}): QuarantineItemView => ({
  id: "i1",
  entryPoint: "api_body",
  ruleIds: ["PHI.SSN"],
  guardVersion: "guard-test",
  status: "held",
  createdAt: "2026-11-13T00:00:00.000Z",
  heldUntil: "2026-12-13T00:00:00.000Z",
  decidedBy: null,
  decisionReason: null,
  contentPurged: false,
  ...over,
});

function api(over: Partial<QuarantineApi> = {}): QuarantineApi {
  return {
    list: vi.fn(async () => ({ items: [item()] })),
    viewContent: vi.fn(async () => ({ content: "synthetic held text" })),
    release: vi.fn(async () => item({ status: "released" })),
    discard: vi.fn(async () => item({ status: "discarded" })),
    ...over,
  };
}

describe("quarantine review", () => {
  it("shows the block reason from metadata before any content is opened", async () => {
    const a = api();
    render(<QuarantineReview api={a} />);
    expect(await screen.findByText(/PHI\.SSN/)).toBeTruthy();
    expect(a.viewContent).not.toHaveBeenCalled();
  });

  it("opens content, then releases with a reason", async () => {
    const a = api();
    const ui = userEvent.setup();
    render(<QuarantineReview api={a} />);
    await ui.click(await screen.findByRole("button", { name: /view content/i }));
    expect(await screen.findByLabelText("Held content")).toBeTruthy();
    await ui.type(screen.getByLabelText("Reason"), "benign near-miss");
    await ui.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(a.release).toHaveBeenCalledWith("i1", "benign near-miss"));
  });

  it("discards with a reason", async () => {
    const a = api();
    const ui = userEvent.setup();
    render(<QuarantineReview api={a} />);
    await ui.click(await screen.findByRole("button", { name: /view content/i }));
    await ui.type(await screen.findByLabelText("Reason"), "real PHI, destroy");
    await ui.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(a.discard).toHaveBeenCalledWith("i1", "real PHI, destroy"));
  });

  it("refuses to decide without a reason", async () => {
    const a = api();
    const ui = userEvent.setup();
    render(<QuarantineReview api={a} />);
    await ui.click(await screen.findByRole("button", { name: /view content/i }));
    await ui.click(await screen.findByRole("button", { name: "Release" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/reason/i);
    expect(a.release).not.toHaveBeenCalled();
  });

  it("offers no view button for purged or decided items", async () => {
    const a = api({
      list: vi.fn(async () => ({
        items: [item({ contentPurged: true }), item({ id: "i2", status: "released" })],
      })),
    });
    render(<QuarantineReview api={a} />);
    await screen.findAllByText(/PHI\.SSN/);
    expect(screen.queryByRole("button", { name: /view content/i })).toBeNull();
  });

  it("is in the navigation only with quarantine.review", () => {
    expect(visibleNavItems(["jobs.read"]).map((i) => i.label)).not.toContain("Quarantine");
    expect(visibleNavItems(["quarantine.review"]).map((i) => i.label)).toContain("Quarantine");
  });
});

describe("advisory PHI warning", () => {
  it("warns on SSN-like and labelled identifiers, and stays quiet otherwise", () => {
    expect(looksLikePhi("ssn 000-12-3456")).toBe(true);
    expect(looksLikePhi("MRN: 00123456")).toBe(true);
    expect(looksLikePhi("fields: patient_id, mrn, dob")).toBe(false);
  });

  it("renders a note and does not block anything", () => {
    render(<PhiWarning value="ssn 000-12-3456" />);
    expect(screen.getByRole("note").textContent).toMatch(/do not enter phi/i);
    cleanup();
    const { container } = render(<PhiWarning value="hello" />);
    expect(container.textContent).toBe("");
  });
});
