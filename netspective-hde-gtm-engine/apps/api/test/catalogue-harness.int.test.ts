import { describe, expect, it } from "vitest";
import { buildCatalogueHarness } from "../test-support/catalogue-harness.js";

// The harness itself: seeded database, role permissions and the fake clock (task T014).
describe("catalogue harness", () => {
  it("starts from the migrated, seeded database", () => {
    const h = buildCatalogueHarness();
    expect(h.count("engagement_offer")).toBe(10);
    expect(h.count("service_capability")).toBe(19);
  });
  it("gives each person the permissions of their role", () => {
    const h = buildCatalogueHarness();
    expect(h.actor("lead").permissions).toContain("claims.approve");
    expect(h.actor("marketing").permissions).toContain("claims.phrases.manage");
    expect(h.actor("drafter").permissions).toContain("claims.draft");
    expect(h.actor("drafter").permissions).not.toContain("claims.approve");
    expect(h.actor("executive").permissions).not.toContain("offers.edit");
  });
  it("moves the clock on request", () => {
    const h = buildCatalogueHarness();
    const before = h.now().getTime();
    h.advanceDays(2);
    expect(h.now().getTime() - before).toBe(2 * 86_400_000);
  });
});
