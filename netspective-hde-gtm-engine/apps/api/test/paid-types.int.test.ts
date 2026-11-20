import { describe, expect, it } from "vitest";
import { buildCatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T044: the three paid engagement types and deliverables that are not in the source (quickstart V20,
// V21; spec FR-024 to FR-026, SC-007).
describe("paid engagement types", () => {
  it("lists the three types with the stated scope and Resilience Review inactive", () => {
    const h = buildCatalogueHarness();
    const types = h.paidTypes.list(h.actor("analyst"));
    expect(types.map((t) => t.key)).toEqual([
      "input_audit",
      "resilience_review",
      "sender_readiness_sprint",
    ]);
    const by = Object.fromEntries(types.map((t) => [t.key, t]));
    expect(by["sender_readiness_sprint"]).toMatchObject({
      weeksMin: 6,
      weeksMax: 6,
      status: "active",
      scope: ["3 to 5 senders", "one format"],
    });
    expect(by["input_audit"]).toMatchObject({
      weeksMin: 6,
      weeksMax: 8,
      scope: ["one use case", "1 to 2 sources"],
    });
    expect(by["resilience_review"]).toMatchObject({
      status: "inactive",
      scopeConfirmed: false,
      scope: [],
    });
    expect(by["sender_readiness_sprint"]?.deliverables.map((d) => d.text).sort()).toEqual([
      "header contract",
      "per-sender rejection reporting",
      "raw-first landing",
    ]);
  });

  it("has no price, fee, rate or currency field anywhere in the response", () => {
    const h = buildCatalogueHarness();
    const json = JSON.stringify(h.paidTypes.list(h.actor("lead")));
    expect(json).not.toMatch(/"(price|pricing|fee|fees|rate|rates|currency|cost|amount)"/i);
  });

  it("rejects a price, fee, rate or currency key as unknown", () => {
    const h = buildCatalogueHarness();
    for (const key of ["price", "fee", "rate", "currency"]) {
      expect(
        () => h.paidTypes.update(h.actor("lead"), "input_audit", { lockNo: 1, [key]: "10" }),
        key,
      ).toThrow(/Invalid fields/);
    }
    expect(h.paidTypes.list(h.actor("lead")).find((t) => t.key === "input_audit")?.lockNo).toBe(1);
  });

  it("edits scope, weeks and status with a lock number, and needs paid_types.edit", () => {
    const h = buildCatalogueHarness();
    const t = h.paidTypes.update(h.actor("lead"), "resilience_review", {
      lockNo: 1,
      scope: ["one environment"],
      weeksMin: 4,
      weeksMax: 6,
      scopeConfirmed: true,
    });
    expect(t).toMatchObject({
      scope: ["one environment"],
      weeksMin: 4,
      weeksMax: 6,
      scopeConfirmed: true,
      lockNo: 2,
    });
    expect(() =>
      h.paidTypes.update(h.actor("lead"), "resilience_review", { lockNo: 1, scope: ["x scope"] }),
    ).toThrow(/reload/i);
    expect(() =>
      h.paidTypes.update(h.actor("analyst"), "resilience_review", {
        lockNo: 2,
        scope: ["y scope"],
      }),
    ).toThrow(/permission/);
    expect(() =>
      h.paidTypes.update(h.actor("lead"), "resilience_review", {
        lockNo: 2,
        weeksMin: 8,
        weeksMax: 6,
      }),
    ).toThrow(/weeks/i);
  });
});

describe("deliverables outside the source", () => {
  it("start pending, cannot be used and are refused PHI-like text", () => {
    const h = buildCatalogueHarness();
    const t = h.paidTypes.proposeDeliverable(h.actor("lead"), "input_audit", {
      text: "A weekly status call",
    });
    const d = t.deliverables.find((x) => x.text === "A weekly status call");
    expect(d).toMatchObject({ inSource: false, approval: "pending_approval", approvedBy: null });
    expect(
      h.paidTypes
        .usableDeliverables("input_audit")
        .map((x) => x.text)
        .sort(),
    ).toEqual(["go/no-go memo", "lineage-tracked feed"]);
    expect(() =>
      h.paidTypes.proposeDeliverable(h.actor("lead"), "input_audit", {
        text: "Patient 123-45-6789 file",
      }),
    ).toThrow();
    expect(h.anyText(/123-45-6789/)).toBe(false);
  });

  it("are approved or rejected only by a holder of paid_types.approve, with the decision audited", () => {
    const h = buildCatalogueHarness();
    const proposed = h.paidTypes.proposeDeliverable(h.actor("lead"), "input_audit", {
      text: "A weekly status call",
    });
    const id = proposed.deliverables.find((x) => x.text === "A weekly status call")!.id;
    const noRight = {
      ...h.actor("lead"),
      permissions: h.actor("lead").permissions.filter((p) => p !== "paid_types.approve"),
    };
    expect(() =>
      h.paidTypes.decideDeliverable(noRight, "input_audit", id, {
        decision: "approve",
        note: "Fine by me",
      }),
    ).toThrow(/permission/);
    expect(() =>
      h.paidTypes.decideDeliverable(h.actor("analyst"), "input_audit", id, {
        decision: "approve",
        note: "Fine by me",
      }),
    ).toThrow(/permission/);
    h.paidTypes.decideDeliverable(h.actor("lead"), "input_audit", id, {
      decision: "approve",
      note: "Agreed with the service lead",
    });
    expect(h.paidTypes.usableDeliverables("input_audit").map((x) => x.text)).toContain(
      "A weekly status call",
    );
    expect(h.audit("paid_type.deliverable.decide").map((a) => [a.actor_id, a.entity_id])).toEqual([
      ["lead-1", id],
    ]);
  });

  it("can be rejected, stays unusable, and cannot be decided twice", () => {
    const h = buildCatalogueHarness();
    const id = h.paidTypes
      .proposeDeliverable(h.actor("lead"), "input_audit", { text: "Unrequested extra report" })
      .deliverables.find((x) => x.text === "Unrequested extra report")!.id;
    h.paidTypes.decideDeliverable(h.actor("lead"), "input_audit", id, {
      decision: "reject",
      note: "Not in scope",
    });
    expect(h.paidTypes.usableDeliverables("input_audit").map((x) => x.text)).not.toContain(
      "Unrequested extra report",
    );
    expect(() =>
      h.paidTypes.decideDeliverable(h.actor("lead"), "input_audit", id, {
        decision: "approve",
        note: "Changed my mind",
      }),
    ).toThrow(/already/i);
  });

  it("refuses a decision note under three characters, an unknown type and an in-source deliverable", () => {
    const h = buildCatalogueHarness();
    const seeded = h.paidTypes.list(h.actor("lead")).find((t) => t.key === "input_audit")!
      .deliverables[0]!;
    expect(() =>
      h.paidTypes.decideDeliverable(h.actor("lead"), "input_audit", seeded.id, {
        decision: "reject",
        note: "no",
      }),
    ).toThrow(/Invalid fields/);
    expect(() =>
      h.paidTypes.decideDeliverable(h.actor("lead"), "input_audit", seeded.id, {
        decision: "reject",
        note: "Not wanted",
      }),
    ).toThrow(/already|source/i);
    expect(() =>
      h.paidTypes.proposeDeliverable(h.actor("lead"), "no_such_type", { text: "Something new" }),
    ).toThrow(/not found/i);
  });

  it("emits no event for deliverable changes (audit-only)", () => {
    const h = buildCatalogueHarness();
    h.paidTypes.proposeDeliverable(h.actor("lead"), "input_audit", {
      text: "A weekly status call",
    });
    expect(h.count("outbox_event")).toBe(0);
  });
});
