import { describe, expect, it } from "vitest";
import { buildCatalogueHarness, FULL_CAPABILITY } from "../test-support/catalogue-harness.js";

// Task T043: the capability catalogue (quickstart V23 to V25; spec FR-021 to FR-023).
const ID = "capability-01";

describe("the seeded catalogue", () => {
  it("lists 19 slots with every attribute to be provided, and no delivery example", () => {
    const h = buildCatalogueHarness();
    const items = h.capabilities.list(h.actor("analyst"));
    expect(items).toHaveLength(19);
    for (const c of items) {
      expect(c.name).toBeNull();
      expect(c.publicClaimStatus).toBe("not_approved");
      expect(c.publicClaimNeedsReview).toBe(false);
      expect(c.placeholderAttributes).toEqual([
        "name",
        "description",
        "inputTypes",
        "outputTypes",
        "buyerProblems",
        "limitations",
        "requiredExpertise",
        "potentialPaidTypeKey",
      ]);
    }
    expect(JSON.stringify(items)).not.toMatch(/deliveryExamples/);
  });

  it("needs capabilities.read", () => {
    const h = buildCatalogueHarness();
    expect(() => h.capabilities.list({ ...h.actor("analyst"), permissions: [] })).toThrow(
      /permission/,
    );
  });
});

describe("editing", () => {
  it("changes only the attributes sent, bumps the lock number and keeps nulls for the rest", () => {
    const h = buildCatalogueHarness();
    const c = h.capabilities.update(h.actor("lead"), ID, {
      lockNo: 1,
      attributes: { name: "Sender readiness", inputTypes: ["CSV"] },
    });
    expect(c).toMatchObject({
      name: "Sender readiness",
      lockNo: 2,
      attributes: { inputTypes: ["CSV"], description: null },
    });
    expect(c.placeholderAttributes).not.toContain("name");
    expect(c.placeholderAttributes).toContain("description");
  });

  it("returns 409 for a stale lock number and stores nothing", () => {
    const h = buildCatalogueHarness();
    h.capabilities.update(h.actor("lead"), ID, { lockNo: 1, attributes: { name: "A" } });
    expect(() =>
      h.capabilities.update(h.actor("lead"), ID, { lockNo: 1, attributes: { name: "B" } }),
    ).toThrow(/reload/i);
    expect(h.capabilities.get(h.actor("lead"), ID).name).toBe("A");
  });

  it("refuses PHI-like text whole, unknown fields and over-long values, and needs capabilities.edit", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.capabilities.update(h.actor("lead"), ID, {
        lockNo: 1,
        attributes: { description: "Call 123-45-6789 first" },
      }),
    ).toThrow();
    expect(() =>
      h.capabilities.update(h.actor("lead"), ID, { lockNo: 1, attributes: { price: "9" } }),
    ).toThrow(/Invalid fields/);
    expect(() =>
      h.capabilities.update(h.actor("lead"), ID, {
        lockNo: 1,
        attributes: { name: "x".repeat(201) },
      }),
    ).toThrow(/Invalid fields/);
    expect(() =>
      h.capabilities.update(h.actor("analyst"), ID, { lockNo: 1, attributes: { name: "A" } }),
    ).toThrow(/permission/);
    expect(h.capabilities.get(h.actor("lead"), ID).lockNo).toBe(1);
    expect(h.anyText(/123-45-6789/)).toBe(false);
  });

  it("audits the change and emits capability.updated with an identifier and a change type only", () => {
    const h = buildCatalogueHarness();
    h.capabilities.update(h.actor("lead"), ID, {
      lockNo: 1,
      attributes: { name: "Secret capability name" },
    });
    expect(h.audit("capability.edit").map((a) => a.actor_id)).toEqual(["lead-1"]);
    expect(h.outbox("capability.updated")).toEqual([{ capability_id: ID, change: "edit" }]);
    expect(h.anyText(/Secret capability name/)).toBe(false);
  });
});

describe("evidence, delivery examples and links", () => {
  it("records an evidence basis with a reference and a short note", () => {
    const h = buildCatalogueHarness();
    const c = h.capabilities.addEvidence(h.actor("lead"), ID, {
      basisKind: "delivery_record",
      reference: "engagement-2025-014",
      note: "Two senders onboarded",
    });
    expect(c.evidence).toEqual([
      expect.objectContaining({ basisKind: "delivery_record", reference: "engagement-2025-014" }),
    ]);
    expect(h.outbox("capability.updated").map((e) => e["change"])).toEqual(["evidence"]);
  });

  it("stores an internal example of up to 800 characters and refuses 801 and PHI-like text", () => {
    const h = buildCatalogueHarness();
    h.capabilities.addExample(h.actor("lead"), ID, { text: "x".repeat(800) });
    expect(() => h.capabilities.addExample(h.actor("lead"), ID, { text: "x".repeat(801) })).toThrow(
      /Invalid fields/,
    );
    expect(() =>
      h.capabilities.addExample(h.actor("lead"), ID, { text: "Patient 123-45-6789 case" }),
    ).toThrow();
    expect(h.count("capability_delivery_example")).toBe(1);
    expect(h.anyText(/xxxxxxxx/)).toBe(false);
  });

  it("needs both capabilities.edit and capabilities.examples.read to add an example", () => {
    const h = buildCatalogueHarness();
    const editOnly = {
      ...h.actor("lead"),
      permissions: h.actor("lead").permissions.filter((p) => p !== "capabilities.examples.read"),
    };
    expect(() =>
      h.capabilities.addExample(editOnly, ID, { text: "Internal example text" }),
    ).toThrow(/permission/);
    expect(() =>
      h.capabilities.addExample(h.actor("analyst"), ID, { text: "Internal example text" }),
    ).toThrow(/permission/);
    expect(h.count("capability_delivery_example")).toBe(0);
  });

  it("links a capability and an offer, visible from the capability, and unlinks it", () => {
    const h = buildCatalogueHarness();
    h.capabilities.link(h.actor("lead"), ID, "offer-1");
    h.capabilities.link(h.actor("lead"), ID, "offer-1");
    expect(h.capabilities.get(h.actor("lead"), ID).offers).toEqual([
      { offerId: "offer-1", name: "Sender Onboarding Friction Map" },
    ]);
    expect(h.capabilities.offersFor(h.actor("lead"), "offer-1")).toEqual([
      expect.objectContaining({ id: ID }),
    ]);
    h.capabilities.unlink(h.actor("lead"), ID, "offer-1");
    expect(h.capabilities.get(h.actor("lead"), ID).offers).toEqual([]);
    expect(() => h.capabilities.link(h.actor("lead"), ID, "offer-99")).toThrow(/not found/i);
  });
});

describe("public claim approval", () => {
  const approve = (h: ReturnType<typeof buildCatalogueHarness>, claimId?: string) =>
    h.capabilities.setPublicClaimStatus(h.actor("lead"), ID, {
      status: "approved",
      ...(claimId ? { claimId } : {}),
    });

  it("is refused while any attribute is to be provided", () => {
    const h = buildCatalogueHarness();
    const claim = h.insertApprovedClaim("We map CCDA documents to FHIR.");
    h.capabilities.addEvidence(h.actor("lead"), ID, {
      basisKind: "delivery_record",
      reference: "rec-1",
    });
    expect(() => approve(h, claim)).toThrow(/still to be provided/);
    expect(h.audit("capability.public_status.refused")[0]?.after_summary).toContain(
      "placeholder_attributes",
    );
  });

  it("is refused without an evidence basis", () => {
    const h = buildCatalogueHarness();
    h.capabilities.update(h.actor("lead"), ID, { lockNo: 1, attributes: FULL_CAPABILITY });
    const claim = h.insertApprovedClaim("We map CCDA documents to FHIR.");
    expect(() => approve(h, claim)).toThrow(/evidence basis/i);
    expect(h.audit("capability.public_status.refused")[0]?.after_summary).toContain(
      "no_evidence_basis",
    );
  });

  it("is refused without a claim, or with a claim that is not approved or no longer has valid evidence", () => {
    const h = buildCatalogueHarness();
    h.capabilities.update(h.actor("lead"), ID, { lockNo: 1, attributes: FULL_CAPABILITY });
    h.capabilities.addEvidence(h.actor("lead"), ID, {
      basisKind: "delivery_record",
      reference: "rec-1",
    });
    expect(() => approve(h)).toThrow(/claim/i);
    const draft = h.claims.draft(h.actor("drafter"), { text: "We map CCDA documents to FHIR." });
    expect(() => approve(h, draft.id)).toThrow(/approved claim/i);
    const lapsed = h.insertApprovedClaim("We trace pilot inputs.", {
      expiresAt: "2026-11-01T00:00:00.000Z",
    });
    expect(() => approve(h, lapsed)).toThrow(/approved claim/i);
    expect(() => approve(h, "no-such-claim")).toThrow(/approved claim/i);
    expect(h.capabilities.get(h.actor("lead"), ID).publicClaimStatus).toBe("not_approved");
  });

  it("succeeds with complete attributes, an evidence basis and an approved claim, and then shows in the public view", () => {
    const h = buildCatalogueHarness();
    h.makeCapabilityPublic(ID);
    const c = h.capabilities.get(h.actor("lead"), ID);
    expect(c).toMatchObject({ publicClaimStatus: "approved", publicClaimNeedsReview: false });
    expect(c.publicClaimId).not.toBeNull();
    expect(h.outbox("capability.updated").map((e) => e["change"])).toContain("public_status");
    expect(h.capabilities.publicView().map((p) => p.slot)).toEqual([1]);
  });

  it("reads publicClaimNeedsReview when the linked claim's evidence lapses", () => {
    const h = buildCatalogueHarness();
    h.makeCapabilityPublic(ID);
    h.advanceDays(400);
    expect(h.capabilities.get(h.actor("lead"), ID)).toMatchObject({
      publicClaimStatus: "approved",
      publicClaimNeedsReview: true,
    });
    expect(
      h.capabilities.list(h.actor("lead")).find((c) => c.id === ID)?.publicClaimNeedsReview,
    ).toBe(true);
  });

  it("can be withdrawn, and needs claims.approve", () => {
    const h = buildCatalogueHarness();
    h.makeCapabilityPublic(ID);
    expect(() =>
      h.capabilities.setPublicClaimStatus(h.actor("analyst"), ID, { status: "not_approved" }),
    ).toThrow(/permission/);
    expect(
      h.capabilities.setPublicClaimStatus(h.actor("lead"), ID, { status: "not_approved" })
        .publicClaimStatus,
    ).toBe("not_approved");
    expect(h.capabilities.publicView()).toEqual([]);
  });
});
