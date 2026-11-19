import { beforeEach, describe, expect, it } from "vitest";
import { ACCOUNTS, buildResearchHarness, type Harness } from "../test-support/research-harness.js";
import type { AccountResearchSummary } from "@gtm/ai-contracts";

// Task T038: incremental runs (cache by address and content hash; quickstart V11).
const A = ACCOUNTS;
const SENDERS = "https://news.northvale-hie.example/senders";
const IG = "https://docs.northvale-hie.example/ig-update";
let h: Harness;
beforeEach(() => {
  h = buildResearchHarness({ scenario: "northvale" });
});
const outcomes = (runId: string) =>
  (
    h.db.raw
      .prepare("SELECT outcome FROM research_source_fetch WHERE run_id = ? ORDER BY rowid")
      .all(runId) as { outcome: string }[]
  ).map((r) => r.outcome);
const summary = (runId: string) =>
  JSON.parse(
    (
      h.db.raw.prepare("SELECT summary_json s FROM research_run WHERE id = ?").get(runId) as {
        s: string;
      }
    ).s,
  ) as AccountResearchSummary;

describe("incremental research", () => {
  it("skips unchanged sources with no model call, no cost and no new invocation rows, keeping earlier findings as carried over", async () => {
    const first = await h.runFor(A.northvale.id, [SENDERS, IG]);
    expect(outcomes(first.id)).toEqual(["processed", "processed"]);
    const calls = h.llm.calls.length;
    const invocations = h.count("ai_invocation");
    const second = await h.runFor(A.northvale.id, [SENDERS, IG]);
    expect(outcomes(second.id)).toEqual(["unchanged_skipped", "unchanged_skipped"]);
    expect(h.llm.calls.length).toBe(calls);
    expect(h.count("ai_invocation")).toBe(invocations);
    expect(second.totals.cost).toBe("0.00");
    expect(second.state).toBe("completed");
    const s = summary(second.id);
    expect(s.facts).toHaveLength(2);
    expect(s.facts.every((f) => f.carriedOver)).toBe(true);
    expect(s.unknowns).toHaveLength(5);
    expect(h.count("signal")).toBe(3);
  });
  it("processes a changed source again and carries the unchanged one over", async () => {
    await h.runFor(A.northvale.id, [SENDERS, IG]);
    h.source.setPage({
      address: IG,
      status: 200,
      contentType: "text/html",
      text: "Northvale HIE published an updated implementation guide for claims attachments on 2026-10-02. A further revision followed in November.",
    });
    const calls = h.llm.calls.length;
    const third = await h.runFor(A.northvale.id, [SENDERS, IG]);
    expect(outcomes(third.id)).toEqual(["unchanged_skipped", "processed"]);
    expect(h.llm.calls.length).toBe(calls + 1);
    expect(h.llm.calls.at(-1)!.dataBlocks.filter((b) => b.label === "source")).toHaveLength(1);
    const s = summary(third.id);
    expect(s.facts.some((f) => f.carriedOver)).toBe(true);
    expect(s.facts.some((f) => !f.carriedOver)).toBe(true);
    // Same statements merge into the existing signals instead of creating copies.
    expect(h.count("signal")).toBe(3);
    const merged = h.db.raw
      .prepare(
        "SELECT count(*) c FROM signal_provenance WHERE kind IN ('merged_duplicate','republication')",
      )
      .get() as { c: number };
    expect(merged.c).toBe(0);
  });
  it("processes a page that changed back to an earlier fingerprint (only the latest is compared)", async () => {
    await h.runFor(A.northvale.id, [IG]);
    const original = {
      address: IG,
      status: 200,
      contentType: "text/html",
      text: "Northvale HIE published an updated implementation guide for claims attachments on 2026-10-02. Senders must revise their submissions to match the updated implementation guide.",
    };
    h.source.setPage({ ...original, text: `${original.text} Changed.` });
    const changed = await h.runFor(A.northvale.id, [IG]);
    expect(outcomes(changed.id)).toEqual(["processed"]);
    h.source.setPage(original);
    const back = await h.runFor(A.northvale.id, [IG]);
    expect(outcomes(back.id)).toEqual(["processed"]);
  });
  it("counts a skipped source toward the source limit but not toward cost", async () => {
    await h.runFor(A.northvale.id, [SENDERS, IG]);
    const limited = await h.runFor(A.northvale.id, [SENDERS, IG], { maxSources: 1 });
    expect(outcomes(limited.id)).toEqual(["unchanged_skipped", "budget_skipped"]);
    expect(limited.state).toBe("budget_reached");
  });
});
