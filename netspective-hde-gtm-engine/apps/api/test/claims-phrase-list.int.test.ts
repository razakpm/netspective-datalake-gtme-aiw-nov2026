import { describe, expect, it } from "vitest";
import { DEFAULT_PHRASE_RULES } from "@gtm/domain";
import { buildCatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T050: the phrase list is versioned configuration, owned by the marketing approver and reviewed by a
// second designated approver (spec FR-006).
const NEW_RULES = [
  ...DEFAULT_PHRASE_RULES,
  { id: "blue-sky", class: "ai_ready", kind: "phrase", phrases: ["blue sky"] },
];
const publish = (
  h: ReturnType<typeof buildCatalogueHarness>,
  who: Parameters<ReturnType<typeof buildCatalogueHarness>["actor"]>[0] = "marketing",
  over: Record<string, unknown> = {},
) =>
  h.claimReview.publishPhraseList(h.actor(who), {
    rules: NEW_RULES,
    reviewerId: "lead-1",
    note: "Add the blue sky phrase",
    ...over,
  });

describe("the current list", () => {
  it("shows its version, owner and reviewer", () => {
    const h = buildCatalogueHarness();
    expect(h.claimReview.getPhraseList(h.actor("analyst"))).toMatchObject({
      version: 1,
      owner: "campaign_approver",
      reviewedBy: "seed",
      rules: expect.any(Array),
    });
    expect(() => h.claimReview.getPhraseList({ ...h.actor("analyst"), permissions: [] })).toThrow(
      /permission/,
    );
  });
});

describe("publishing a new version", () => {
  it("adds an immutable row authored by the marketing approver and reviewed by another approver", () => {
    const h = buildCatalogueHarness();
    const list = publish(h);
    expect(list).toMatchObject({ version: 2, owner: "campaign_approver", reviewedBy: "lead-1" });
    const row = h.db.raw
      .prepare(
        "SELECT created_by, reviewed_by, owner FROM restricted_phrase_list WHERE version = 2",
      )
      .get();
    expect(row).toEqual({
      created_by: "marketing-1",
      reviewed_by: "lead-1",
      owner: "campaign_approver",
    });
    expect(h.count("restricted_phrase_list")).toBe(2);
    expect(h.audit("claim.phrase_list.publish").map((a) => a.actor_id)).toEqual(["marketing-1"]);
  });

  it("makes the checker use the new version at once, and keeps the old rows", () => {
    const h = buildCatalogueHarness();
    expect(h.claims.lint(h.actor("analyst"), "Blue sky thinking").matches).toEqual([]);
    publish(h);
    const result = h.claims.lint(h.actor("analyst"), "Blue sky thinking");
    expect(result.listVersion).toBe(2);
    expect(result.matches.map((m) => m.rule)).toEqual(["blue-sky"]);
    expect(
      h.db.raw.prepare("SELECT version FROM restricted_phrase_list ORDER BY version").all(),
    ).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("refuses a reviewer who is the author, who lacks claims.approve or who does not exist", () => {
    const h = buildCatalogueHarness();
    expect(() => publish(h, "marketing", { reviewerId: "marketing-1" })).toThrow(
      /other than the author/i,
    );
    expect(() => publish(h, "marketing", { reviewerId: "analyst-1" })).toThrow(
      /claims.approve|designated/i,
    );
    expect(() => publish(h, "marketing", { reviewerId: "nobody-9" })).toThrow(/designated/i);
    expect(h.count("restricted_phrase_list")).toBe(1);
  });

  it("needs claims.phrases.manage", () => {
    const h = buildCatalogueHarness();
    for (const who of ["lead", "analyst", "drafter", "executive"] as const) {
      expect(() => publish(h, who, { reviewerId: "marketing-1" }), who).toThrow(/permission/);
    }
    expect(h.count("restricted_phrase_list")).toBe(1);
  });

  it("refuses an invalid list: no rules, a bad pattern, a duplicate id or a pattern that matches nothing at all", () => {
    const h = buildCatalogueHarness();
    for (const rules of [
      [],
      [{ id: "bad", class: "ai_ready", kind: "pattern", pattern: "(" }],
      [{ id: "bad", class: "ai_ready", kind: "pattern", pattern: ".*" }],
      [DEFAULT_PHRASE_RULES[0], DEFAULT_PHRASE_RULES[0]],
    ]) {
      expect(() => publish(h, "marketing", { rules })).toThrow();
    }
    expect(h.count("restricted_phrase_list")).toBe(1);
  });

  it("refuses PHI-like notes and short notes, and emits no event", () => {
    const h = buildCatalogueHarness();
    expect(() => publish(h, "marketing", { note: "See 123-45-6789" })).toThrow();
    expect(() => publish(h, "marketing", { note: "ok" })).toThrow(/Invalid fields/);
    publish(h);
    expect(h.count("outbox_event")).toBe(0);
  });
});
