import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { offer1Findings, offer6Findings } from "../test-support/workshop-findings.js";
import { buildWorkshopsHarness, type WorkshopsHarness } from "../test-support/workshops-harness.js";

// Feature 007 task T055 (quickstart V24 to V27; spec FR-030 to FR-032): the gated one-page buyer output.
async function problem(fn: () => unknown) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { status: error.status, codes: error.codes ?? [] };
  }
  throw new Error("expected a refusal");
}
async function setup(offer: 1 | 6 = 1, options = {}) {
  const h = buildWorkshopsHarness(options);
  const id = (await h.heldWorkshop(offer)).id;
  h.findings.save(h.operator(), id, {
    content: offer === 1 ? offer1Findings() : offer6Findings(),
  });
  h.findings.finalise(h.operator(), id);
  return { h, id };
}
type Draft = ReturnType<WorkshopsHarness["outputs"]["generate"]>;
const editable = (draft: Draft, over: Record<string, unknown> = {}) => {
  const { title, summary, nextStep, inScope, outOfScope } = draft.sections;
  return { title, summary, nextStep, inScope, outOfScope, ...over };
};
const edit = (h: WorkshopsHarness, id: string, draft: Draft, over: Record<string, unknown>) =>
  h.outputs.edit(h.operator(), id, {
    baseRevisionNo: draft.revisionNo,
    sections: editable(draft, over),
  });
const pdfs = (h: WorkshopsHarness) => h.files.keys().filter((k) => k.endsWith(".pdf"));

describe("the draft", () => {
  it("needs finalised findings", async () => {
    const h = buildWorkshopsHarness();
    const id = (await h.heldWorkshop(1)).id;
    expect(await problem(() => h.outputs.generate(h.operator(), id))).toMatchObject({
      status: 409,
      codes: ["output_not_ready"],
    });
    h.findings.save(h.operator(), id, { content: offer1Findings() });
    expect(await problem(() => h.outputs.generate(h.operator(), id))).toMatchObject({
      codes: ["output_not_ready"],
    });
  });

  it.each([1, 6] as const)("is built from the Offer %s findings (V24)", async (offer) => {
    const { h, id } = await setup(offer);
    const draft = h.outputs.generate(h.operator(), id);
    expect(draft).toMatchObject({
      revisionNo: 1,
      state: "draft",
      findingVersionNo: 1,
      outOfDate: false,
      problems: [],
    });
    expect(draft.sections.organisation).toBe(h.account(offer).name);
    expect(draft.sections.date).toBe("2026-11-19");
    expect(draft.sections.inScope.length).toBeGreaterThan(0);
    expect(draft.sections.outOfScope.length).toBeGreaterThan(0);
    expect(Boolean(draft.sections.disclaimer)).toBe(offer === 6);
    expect(h.audit("workshop.output.generate")).toHaveLength(1);
    expect(h.anyText(/Synthetic clinical system|manual review/)).toBe(false);
  });

  it("saves each edit as a revision of the one it names, leaving the findings alone", async () => {
    const { h, id } = await setup();
    const first = h.outputs.generate(h.operator(), id);
    const second = edit(h, id, first, { summary: "A tighter summary." });
    expect(second).toMatchObject({ revisionNo: 2, sections: { summary: "A tighter summary." } });
    expect(second.sections.findings).toBe(first.sections.findings);
    expect(await problem(() => edit(h, id, first, { summary: "Another." }))).toMatchObject({
      status: 409,
      codes: ["stale_version"],
    });
    const read = h.outputs.get(h.reader(), id);
    expect(read.revisions.map((r) => r.revisionNo)).toEqual([2, 1]);
    expect(read.latest?.id).toBe(second.id);
    expect(h.findings.get(h.reader(), id).versions).toHaveLength(1);
  });

  it("refuses an edit of a generated section, a removed scope section and patient-like text", async () => {
    const { h, id } = await setup();
    const draft = h.outputs.generate(h.operator(), id);
    for (const [over, code] of [
      [{ findings: "All delays confirmed." }, "generated_section_changed"],
      [{ unknowns: "" }, "generated_section_changed"],
      [{ disclaimer: "None." }, "generated_section_changed"],
      [{ inScope: [] }, "scope_section_missing"],
      [{ outOfScope: undefined }, "scope_section_missing"],
      [{ summary: "Patient: Jordan Testcase, MRN: 00123456" }, "phi_guard"],
    ] as const) {
      expect(await problem(() => edit(h, id, draft, over)), code).toMatchObject({
        status: 422,
        codes: [code],
      });
    }
    expect(h.count("workshop_output_document")).toBe(1);
  });
});

describe("approval", () => {
  it("is for the service lead or an administrator: an operator is refused and audited (V25)", async () => {
    const { h, id } = await setup();
    h.outputs.generate(h.operator(), id);
    for (const actor of [h.operator(), h.reader(), h.automated("ai"), h.automated("system")]) {
      expect(await problem(() => h.outputs.approve(actor, id))).toMatchObject({ status: 403 });
    }
    expect(h.audit("workshop.output.approve.refused")).toHaveLength(4);
    const approved = await h.outputs.approve(h.lead(), id);
    expect(approved).toMatchObject({
      state: "approved",
      approvedBy: "lead-1",
      pdfPages: 1,
    });
    expect(pdfs(h)).toEqual([`workshop-${id}-output-${approved.id}.pdf`]);
    expect(
      h.db.raw.prepare("SELECT pdf_sha256 s FROM workshop_output_document").get(),
    ).toMatchObject({ s: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await h.outputs.pdf(h.reader(), id)).bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await problem(() => h.outputs.approve(h.lead(), id))).toMatchObject({
      codes: ["already_approved"],
    });
  });

  it.each([
    ["restricted wording", "We are HIPAA compliant and guarantee uptime.", "restricted_wording"],
    ["a price", "The sprint costs $9,000.", "price_stated"],
  ])("refuses %s (V26)", async (_label, summary, code) => {
    const { h, id } = await setup();
    const draft = h.outputs.generate(h.operator(), id);
    const changed = edit(h, id, draft, { summary });
    expect(changed.problems.map((p) => p.code)).toContain(code);
    const refused = await problem(() => h.outputs.approve(h.lead(), id));
    expect(refused.status).toBe(422);
    expect(refused.codes).toContain(code);
    expect(pdfs(h)).toEqual([]);
    expect(h.outputs.get(h.reader(), id).latest?.state).toBe("draft");
  });

  it("accepts restricted wording that an approved claim covers", async () => {
    const { h, id } = await setup();
    const sentence = "We guarantee a written answer.";
    const draft = h.outputs.generate(h.operator(), id);
    edit(h, id, draft, { summary: sentence });
    expect(await problem(() => h.outputs.approve(h.lead(), id))).toMatchObject({
      codes: ["restricted_wording"],
    });
    h.insertApprovedClaim(sentence);
    expect((await h.outputs.approve(h.lead(), id)).state).toBe("approved");
  });

  it("refuses a page that is too long", async () => {
    const { h, id } = await setup(1, { outputMaxChars: 500 });
    h.outputs.generate(h.operator(), id);
    expect(await problem(() => h.outputs.approve(h.lead(), id))).toMatchObject({
      codes: ["over_one_page"],
    });
  });

  it("leaves the draft when the renderer fails, makes two pages or cannot store the file", async () => {
    const { h, id } = await setup();
    h.outputs.generate(h.operator(), id);
    h.renderer.failNext();
    expect(await problem(() => h.outputs.approve(h.lead(), id))).toMatchObject({
      codes: ["render_failed"],
    });
    h.renderer.forcePages(2);
    expect(await problem(() => h.outputs.approve(h.lead(), id))).toMatchObject({
      codes: ["over_one_page"],
    });
    h.files.failNext("put");
    expect(await problem(() => h.outputs.approve(h.lead(), id))).toMatchObject({
      codes: ["storage_failed"],
    });
    expect(h.outputs.get(h.reader(), id).latest?.state).toBe("draft");
    expect(pdfs(h)).toEqual([]);
  });
});

describe("sharing", () => {
  const share = (h: WorkshopsHarness, id: string) =>
    h.outputs.share(h.operator(), id, { how: "handed_over", note: "Given at the follow-up" });

  it("needs an approved page, records who, when and how, and sends nothing", async () => {
    const { h, id } = await setup();
    h.outputs.generate(h.operator(), id);
    expect(await problem(() => share(h, id))).toMatchObject({
      status: 409,
      codes: ["output_not_ready"],
    });
    expect(await problem(() => h.outputs.pdf(h.reader(), id))).toMatchObject({
      codes: ["output_not_ready"],
    });
    await h.outputs.approve(h.lead(), id);
    const events = h.count("outbox_event");
    expect(share(h, id)).toMatchObject({
      how: "handed_over",
      sharedBy: "operator-1",
      sharedAt: h.now().toISOString(),
    });
    share(h, id);
    expect(h.outputs.get(h.reader(), id).shares).toHaveLength(2);
    expect(h.count("outbox_event")).toBe(events);
    expect(h.audit("workshop.output.share")).toHaveLength(2);
    expect(h.anyText(/follow-up/)).toBe(false);
  });

  it("makes a new draft after an edit, which must be approved before it is shared", async () => {
    const { h, id } = await setup();
    h.outputs.generate(h.operator(), id);
    const approved = await h.outputs.approve(h.lead(), id);
    const next = edit(h, id, approved, { summary: "Changed after approval." });
    expect(next.state).toBe("draft");
    expect(await problem(() => share(h, id))).toMatchObject({ codes: ["output_not_ready"] });
    await h.outputs.approve(h.lead(), id);
    expect(share(h, id).outputId).toBe(next.id);
    expect(pdfs(h)).toHaveLength(2);
  });

  it("is out of date after a findings correction (V27)", async () => {
    const { h, id } = await setup();
    h.outputs.generate(h.operator(), id);
    await h.outputs.approve(h.lead(), id);
    h.findings.save(h.operator(), id, {
      content: { ...offer1Findings(), flowSummary: "Corrected." },
      correctionReason: "The flow was wrong",
    });
    expect(h.outputs.get(h.reader(), id).latest?.outOfDate).toBe(true);
    for (const attempt of [() => share(h, id), () => h.outputs.pdf(h.reader(), id)]) {
      expect(await problem(attempt)).toMatchObject({ status: 409, codes: ["output_out_of_date"] });
    }
    // A correction that is not yet finalised cannot be turned into a page.
    expect(await problem(() => h.outputs.generate(h.operator(), id))).toMatchObject({
      codes: ["output_not_ready"],
    });
    h.findings.finalise(h.operator(), id);
    const fresh = h.outputs.generate(h.operator(), id);
    expect(fresh).toMatchObject({ findingVersionNo: 2, outOfDate: false });
    expect(fresh.sections.summary).toBe("Corrected.");
    await h.outputs.approve(h.lead(), id);
    expect(share(h, id).outputId).toBe(fresh.id);
  });

  it("says a deleted file is gone", async () => {
    const { h, id } = await setup();
    h.outputs.generate(h.operator(), id);
    await h.outputs.approve(h.lead(), id);
    h.db.raw
      .prepare("UPDATE workshop_output_document SET file_deleted_at = ?")
      .run(h.now().toISOString());
    expect(await problem(() => h.outputs.pdf(h.reader(), id))).toMatchObject({
      status: 410,
      codes: ["file_deleted"],
    });
  });
});
