import { describe, expect, it } from "vitest";
import {
  canonicalizeAuditRow,
  computeRowHash,
  verifyChain,
  type ChainRow,
  type HashableAuditRow,
} from "../../src/index.js";

function base(n: number): HashableAuditRow {
  return {
    id: `id-${n}`,
    occurred_at: `2026-11-13T00:00:0${n}.000Z`,
    actor_id: "u1",
    actor_type: "human",
    action: `thing.${n}`,
    entity_type: "thing",
    entity_id: `t${n}`,
    outcome: "success",
    before_summary: null,
    after_summary: JSON.stringify({ n }),
    correlation_id: "corr-12345",
  };
}

function chain(length: number): ChainRow[] {
  const rows: ChainRow[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= length; i++) {
    const row = base(i);
    const row_hash = computeRowHash(row, prev);
    rows.push({ ...row, prev_hash: prev, row_hash });
    prev = row_hash;
  }
  return rows;
}

describe("canonical form and hashing", () => {
  it("is deterministic and independent of property order", () => {
    const a = base(1);
    const reordered = Object.fromEntries(
      Object.entries(a).reverse(),
    ) as unknown as HashableAuditRow;
    expect(canonicalizeAuditRow(reordered, null)).toBe(canonicalizeAuditRow(a, null));
    expect(computeRowHash(a, null)).toBe(computeRowHash(reordered, null));
    expect(computeRowHash(a, null)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field or the previous hash changes", () => {
    const original = computeRowHash(base(1), null);
    for (const change of [
      { action: "other" },
      { outcome: "denied" },
      { after_summary: "{}" },
      { actor_id: null },
      { occurred_at: "2026-11-13T00:00:09.000Z" },
    ] as const) {
      expect(computeRowHash({ ...base(1), ...change }, null)).not.toBe(original);
    }
    expect(computeRowHash(base(1), "abc")).not.toBe(original);
  });

  it("cannot be fooled by moving text between fields", () => {
    const a = computeRowHash({ ...base(1), action: "ab", entity_type: "c" }, null);
    const b = computeRowHash({ ...base(1), action: "a", entity_type: "bc" }, null);
    expect(a).not.toBe(b);
  });
});

describe("verifyChain", () => {
  it("verifies an unmodified chain, including an empty one", () => {
    expect(verifyChain(chain(5))).toEqual({ ok: true, count: 5 });
    expect(verifyChain([])).toEqual({ ok: true, count: 0 });
  });

  it("detects an altered row and names it", () => {
    const rows = chain(5);
    rows[2] = { ...rows[2]!, outcome: "failed" };
    expect(verifyChain(rows)).toEqual({ ok: false, rowId: "id-3", reason: "hash_mismatch" });
  });

  it("detects a removed row and names the row after the gap", () => {
    const rows = chain(5);
    rows.splice(2, 1);
    expect(verifyChain(rows)).toEqual({ ok: false, rowId: "id-4", reason: "broken_link" });
  });

  it("detects reordered rows", () => {
    const rows = chain(5);
    [rows[1], rows[2]] = [rows[2]!, rows[1]!];
    const result = verifyChain(rows);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ rowId: "id-3", reason: "broken_link" });
  });

  it("detects a rewritten row whose hash was recomputed (the next link breaks)", () => {
    const rows = chain(4);
    const forged = { ...rows[1]!, action: "forged" };
    forged.row_hash = computeRowHash(forged, forged.prev_hash);
    rows[1] = forged;
    expect(verifyChain(rows)).toEqual({ ok: false, rowId: "id-3", reason: "broken_link" });
  });

  it("accepts a chain that starts at an anchor after retention removed older rows", () => {
    const rows = chain(5).slice(2);
    expect(verifyChain(rows).ok).toBe(false); // first row's prev_hash is not null
    expect(verifyChain(rows, { anchorPrevHash: rows[0]!.prev_hash })).toEqual({
      ok: true,
      count: 3,
    });
    expect(verifyChain(rows, { anchorPrevHash: "wrong" })).toMatchObject({
      ok: false,
      rowId: "id-3",
    });
  });
});
