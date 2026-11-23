import { describe, expect, it } from "vitest";
import { validateSessionDecisions } from "../../src/workshops/intake.js";

// Task T056 (spec FR-024): a working session request lists one to five open decisions, each up to 300 characters.
describe("validateSessionDecisions", () => {
  it("accepts one to five trimmed decisions", () => {
    for (const n of [1, 3, 5]) {
      const decisions = Array.from(
        { length: n },
        (_, i) => `  Which OBX segment carries result ${i + 1}?  `,
      );
      expect(validateSessionDecisions(decisions)).toEqual({
        ok: true,
        decisions: decisions.map((d) => d.trim()),
      });
    }
  });
  it("refuses none, six, a blank, a too-short and an over-long decision with plain messages", () => {
    const refused = (decisions: string[]) => validateSessionDecisions(decisions);
    expect(refused([])).toMatchObject({ ok: false });
    expect(refused(Array(6).fill("A real open decision"))).toMatchObject({ ok: false });
    expect(refused(["   "])).toMatchObject({ ok: false });
    expect(refused(["ab"])).toMatchObject({ ok: false });
    const long = refused(["x".repeat(301)]);
    expect(long).toMatchObject({ ok: false });
    if (!long.ok) expect(long.messages.join(" ")).toMatch(/300/);
    const six = refused(Array(6).fill("A real open decision"));
    if (!six.ok) expect(six.messages.join(" ")).toMatch(/five/i);
  });
  it("accepts a decision of exactly 300 characters", () => {
    expect(validateSessionDecisions(["x".repeat(300)]).ok).toBe(true);
  });
});
