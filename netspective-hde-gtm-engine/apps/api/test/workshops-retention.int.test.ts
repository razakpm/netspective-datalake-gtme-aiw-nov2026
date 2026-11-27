import { describe, expect, it } from "vitest";
import { registerWorkshopHandlers } from "../src/worker/workshop-handlers.js";
import { HandlerRegistry } from "../src/worker/registry.js";
import { offer1Findings } from "../test-support/workshop-findings.js";
import { buildWorkshopsHarness, type WorkshopsHarness } from "../test-support/workshops-harness.js";

// Feature 007 task T070 (quickstart V31, spec FR-038): files expire, records stay.
const files = (h: WorkshopsHarness) => h.files.keys().filter((k) => k.startsWith("workshop-"));
const record = (h: WorkshopsHarness, id: string) =>
  h.artifacts.record(h.operator(), id, {
    kind: "scrubbed_rejection_log",
    title: "Rejection log",
    content: "rejected: unit code missing",
  });

async function three() {
  const h = buildWorkshopsHarness();
  // Closed, with an approved page and a file.
  const closed = (await h.heldWorkshop(1)).id;
  await record(h, closed);
  h.findings.save(h.operator(), closed, { content: offer1Findings() });
  h.findings.finalise(h.operator(), closed);
  h.outputs.generate(h.operator(), closed);
  await h.outputs.approve(h.lead(), closed);
  await h.workshops.transition(h.operator(), closed, {
    action: "close",
    lockNo: h.workshops.get(h.operator(), closed).lockNo,
    note: "findings agreed",
  });
  // Cancelled, and one that never reaches an end state.
  const cancelled = h.workshops.convert(h.operator(), (await h.linkedIntake(1)).requestId).id;
  await record(h, cancelled);
  await h.workshops.transition(h.operator(), cancelled, {
    action: "cancel",
    lockNo: 1,
    note: "buyer asked",
  });
  const open = (await h.heldWorkshop(1)).id;
  await record(h, open);
  return { h, closed, cancelled, open };
}

describe("retention", () => {
  it("deletes nothing before twelve months", async () => {
    const { h } = await three();
    h.advanceDays(360);
    expect(await h.retention.run()).toEqual({ deleted: 0, failed: 0 });
    expect(files(h)).toHaveLength(4);
  });

  it("deletes the files after twelve months and keeps every record", async () => {
    const { h, closed } = await three();
    const kept = () =>
      ["workshop", "workshop_artifact", "workshop_finding", "workshop_output_document"].map((t) =>
        h.count(t),
      );
    const before = kept();
    h.advanceDays(396);
    expect(await h.retention.run()).toEqual({ deleted: 4, failed: 0 });
    expect(files(h)).toEqual([]);
    expect(kept()).toEqual(before);
    expect(h.count("workshop_artifact", "file_deleted_at IS NOT NULL")).toBe(3);
    expect(h.count("workshop_output_document", "file_deleted_at IS NOT NULL")).toBe(1);
    expect(h.audit("workshop.file.delete")).toHaveLength(4);
    expect(h.audit("workshop.file.delete")[0]).toMatchObject({ actor_id: null });
    expect(h.anyText(/unit code missing|Rejection log/)).toBe(false);
    expect(h.findings.get(h.reader(), closed).versions).toHaveLength(1);
    // Running again changes nothing.
    expect(await h.retention.run()).toEqual({ deleted: 0, failed: 0 });
    expect(h.audit("workshop.file.delete")).toHaveLength(4);
  });

  it("counts an unfinished workshop from its last change, including a new file", async () => {
    const { h, open } = await three();
    h.advanceDays(300);
    await record(h, open);
    h.advanceDays(96);
    // The two ended workshops expire; the one still in use keeps both of its files.
    expect(await h.retention.run()).toEqual({ deleted: 3, failed: 0 });
    expect(files(h).every((k) => k.startsWith(`workshop-${open}-`))).toBe(true);
    expect(files(h)).toHaveLength(2);
    h.advanceDays(300);
    expect((await h.retention.run()).deleted).toBe(2);
  });

  it("tries a failed delete again the next time", async () => {
    const { h } = await three();
    h.advanceDays(396);
    h.files.failNext("delete");
    expect(await h.retention.run()).toEqual({ deleted: 3, failed: 1 });
    expect(
      h.count("workshop_artifact", "file_deleted_at IS NULL AND storage_key IS NOT NULL"),
    ).toBe(1);
    expect(await h.retention.run()).toEqual({ deleted: 1, failed: 0 });
    expect(files(h)).toEqual([]);
  });

  it("runs as a worker job", async () => {
    const { h } = await three();
    h.advanceDays(396);
    const registry = new HandlerRegistry();
    registerWorkshopHandlers(registry, { retention: h.retention });
    expect(registry.queues()).toEqual(["workshops.retention"]);
    await registry.get("workshops.retention")!({} as never);
    expect(files(h)).toEqual([]);
  });
});
