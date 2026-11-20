import { describe, expect, it } from "vitest";
import { FOUNDATION_ROLE_PERMISSIONS, ROLE_KEYS, type Permission } from "@gtm/domain";
import { buildCatalogueHarness, type CatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T054: every one of the 15 new permissions is checked on the service that uses it, by an actor without
// it (refused and audited), and the role mapping is the documented one (quickstart V28; research R-12).
const FIFTEEN = [
  "capabilities.read",
  "capabilities.edit",
  "capabilities.examples.read",
  "offers.read",
  "offers.edit",
  "offers.status.change",
  "offers.limitations.acknowledge",
  "offers.capacity.edit",
  "offers.bookings.edit",
  "claims.read",
  "claims.draft",
  "claims.approve",
  "claims.phrases.manage",
  "paid_types.edit",
  "paid_types.approve",
] as const satisfies readonly Permission[];

type Op = (h: CatalogueHarness, who: ReturnType<CatalogueHarness["actor"]>) => unknown;
const OPS: Record<(typeof FIFTEEN)[number], Op> = {
  "capabilities.read": (h, a) => h.capabilities.list(a),
  "capabilities.edit": (h, a) =>
    h.capabilities.update(a, "capability-01", { lockNo: 1, attributes: { name: "A" } }),
  "capabilities.examples.read": (h, a) =>
    h.capabilities.addExample(a, "capability-01", { text: "Internal example text" }),
  "offers.read": (h, a) => h.offers.list(a),
  "offers.edit": (h, a) =>
    h.offers.createVersion(a, "offer-2", { patch: { name: "A" }, reason: "Reason" }, 1),
  "offers.status.change": (h, a) =>
    h.offerStatus.moveStatus(a, "offer-2", 1, "internally_reviewed", "ok"),
  "offers.limitations.acknowledge": (h, a) =>
    h.limitations.acknowledge(a, "limitation-offer-7-evaluation"),
  "offers.capacity.edit": (h, a) =>
    h.capacity.setLimit(a, "offer-2", { periodKind: "week", limitSessions: 2 }),
  "offers.bookings.edit": (h, a) => h.bookings.record(a, "offer-6", { sessionDate: "2026-11-20" }),
  "claims.read": (h, a) => h.claims.list(a),
  "claims.draft": (h, a) => h.claims.draft(a, { text: "We review sender feeds." }),
  "claims.approve": (h, a) => {
    const c = h.claims.draft(h.actor("drafter"), { text: "We review sender feeds weekly." });
    h.claims.addEvidence(h.actor("drafter"), c.id, {
      kind: "document",
      reference: "doc-1",
      owner: "Owner",
    });
    return h.claimReview.review(a, c.id, { decision: "approve", note: "Checked it" });
  },
  "claims.phrases.manage": (h, a) =>
    h.claimReview.publishPhraseList(a, {
      rules: h.claimReview.getPhraseList(h.actor("admin")).rules,
      reviewerId: "lead-1",
      note: "No change, republish",
    }),
  "paid_types.edit": (h, a) =>
    h.paidTypes.update(a, "input_audit", { lockNo: 1, scope: ["one use case"] }),
  "paid_types.approve": (h, a) => {
    const t = h.paidTypes.proposeDeliverable(h.actor("lead"), "input_audit", {
      text: "A weekly status call",
    });
    return h.paidTypes.decideDeliverable(
      a,
      "input_audit",
      t.deliverables.find((d) => d.text === "A weekly status call")!.id,
      {
        decision: "approve",
        note: "Agreed",
      },
    );
  },
};

describe.each(FIFTEEN)("permission %s", (permission) => {
  it("is required: an administrator without it is refused with a plain message and an audited refusal", () => {
    const h = buildCatalogueHarness();
    const admin = h.actor("admin");
    const without = { ...admin, permissions: admin.permissions.filter((p) => p !== permission) };
    const before = h.count("audit_event", "outcome = 'denied'");
    expect(() => OPS[permission](h, without)).toThrow(/permission/);
    expect(h.count("audit_event", "outcome = 'denied'")).toBe(before + 1);
  });

  it("is enough: the administrator holding it succeeds", () => {
    const h = buildCatalogueHarness();
    expect(() => OPS[permission](h, h.actor("admin"))).not.toThrow();
  });

  it("never lets an AI or service actor act, even if it somehow carried the permission", () => {
    const h = buildCatalogueHarness();
    for (const actorType of ["ai", "system"] as const) {
      expect(() => OPS[permission](h, { ...h.actor("admin"), actorType }), actorType).toThrow(
        /permission/,
      );
    }
  });
});

describe("the role mapping (hypothesis, open question 48)", () => {
  const held = (role: (typeof ROLE_KEYS)[number]) =>
    FOUNDATION_ROLE_PERMISSIONS[role]
      .filter((p) => (FIFTEEN as readonly string[]).includes(p))
      .sort();
  const reads = ["capabilities.read", "claims.read", "offers.read"];

  it("matches research R-12", () => {
    expect(held("sales_service_lead")).toEqual(
      [
        ...reads,
        "capabilities.edit",
        "capabilities.examples.read",
        "offers.edit",
        "offers.status.change",
        "offers.limitations.acknowledge",
        "offers.capacity.edit",
        "offers.bookings.edit",
        "paid_types.edit",
        "claims.approve",
        "paid_types.approve",
      ].sort(),
    );
    expect(held("campaign_approver")).toEqual([
      "claims.approve",
      "claims.draft",
      "claims.phrases.manage",
      "claims.read",
    ]);
    expect(held("gtm_operator")).toEqual([...reads, "claims.draft"].sort());
    expect(held("research_analyst")).toEqual([...reads, "claims.draft"].sort());
    expect(held("technical_sme_reviewer")).toEqual(reads);
    expect(held("read_only_executive")).toEqual(reads);
    expect(held("administrator")).toEqual([...FIFTEEN].sort());
  });

  it("gives delivery examples only to the service lead and the administrator", () => {
    expect(ROLE_KEYS.filter((r) => held(r).includes("capabilities.examples.read"))).toEqual([
      "sales_service_lead",
      "administrator",
    ]);
  });
});
