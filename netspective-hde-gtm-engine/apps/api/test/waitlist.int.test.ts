import { describe, expect, it } from "vitest";
import { buildOffersHarness } from "../test-support/offers-harness.js";

// Task T053 (quickstart V15 to V17, Scenario G): a full offer is not recommended, with alternatives and a wait-list.
const O6 = "pilot-input-trace-workshop";
const codesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    return (e as { codes?: string[] }).codes ?? [];
  }
  return [];
};

function setup() {
  const h = buildOffersHarness();
  const op = h.actor("operator");
  const o = h.org("riverbend", [
    ["mid_size_judgement", "derived_interpretation"],
    ["stalled_ai_pilot", "buyer_confirmed"],
  ]);
  const c = h.contact(o.id, "casey@riverbend-health.example", { consent: "given" });
  h.hypothesis(o.id, "pilot_input_quality");
  return { h, op, o, c };
}

describe("Scenario G: capacity exhausted", () => {
  it("does not recommend a full Offer 6, lists the alternatives with reasons, and recommends it again once a place is free (V15)", async () => {
    const { h, op, o, c } = setup();
    const bookings = h.fillCapacity(h.offerId(6), 3);
    const r = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(r).toMatchObject({ outcome: "research", offerKey: null, outreach: "allowed" });
    expect(r.excluded).toContainEqual({ offerKey: O6, code: "capacity_exhausted" });
    expect(r.eligible.map((e) => e.offerKey)).not.toContain(O6);
    expect(r.alternatives.map((a) => a.kind)).toEqual([
      "wait_list",
      "offer",
      "research",
      "do_nothing",
    ]);
    expect(r.alternatives.every((a) => a.reason.length > 0)).toBe(true);

    h.bookings.cancel(h.actor("lead"), bookings[0]!.id);
    h.recommendations.dismiss(op, r.id, { reason: "A place has opened" });
    const again = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(again).toMatchObject({ outcome: "offer", offerKey: O6 });
    expect(again.alternatives).toEqual([]);
  });

  it("says an offer with no limit set is not treated as unlimited, and still recommends it (V16)", async () => {
    const { h, op } = setup();
    const o = h.org("northvale", [["sender_onboarding_friction", "observed"]]);
    h.hypothesis(o.id, "capability_gap", { capabilities: ["ccda_to_fhir_mapping"] });
    const r = await h.recommendations.recommend(op, { accountId: o.id });
    expect(r.offerKey).toBe("ccda-to-fhir-mapping-decision-register");
    expect(r.limitations.join(" ")).toContain("not treated as unlimited");
    expect(r.excluded).toEqual([]);
  });
});

describe("the wait-list (V17)", () => {
  it("records who, when and why, lists oldest first, and sends nothing", async () => {
    const { h, o, c } = setup();
    const lead = h.actor("operator");
    const second = h.org("northvale");
    const e1 = h.waitlist.add(lead, "offer-6", {
      accountId: o.id,
      contactId: c.id,
      reason: "Offer 6 is full this month",
    });
    h.advance(60_000);
    const e2 = h.waitlist.add(lead, "offer-6", {
      accountId: second.id,
      reason: "Interested in the next month",
    });
    expect(e1).toMatchObject({
      state: "waiting",
      addedBy: "operator-1",
      reason: "Offer 6 is full this month",
      contactId: c.id,
    });
    expect(h.waitlist.list(lead, "offer-6").map((e) => e.id)).toEqual([e1.id, e2.id]);
    expect(h.count("outbox_event", "type NOT IN ('account.created','contact.identified')")).toBe(0);
    expect(h.audit("offer.waitlist.add")).toHaveLength(2);
    expect(h.anyText(/casey|riverbend|full this month/i)).toBe(false);
  });

  it("refuses a duplicate, an unknown account, contact or offer, a short or PHI-like reason", () => {
    const { h, o, c } = setup();
    const lead = h.actor("operator");
    h.waitlist.add(lead, "offer-6", {
      accountId: o.id,
      contactId: c.id,
      reason: "Offer 6 is full",
    });
    expect(
      codesOf(() =>
        h.waitlist.add(lead, "offer-6", {
          accountId: o.id,
          contactId: c.id,
          reason: "Again please",
        }),
      ),
    ).toContain("already_waiting");
    expect(
      codesOf(() =>
        h.waitlist.add(lead, "offer-6", { accountId: "nope", reason: "Offer 6 is full" }),
      ),
    ).toContain("unknown_account");
    expect(
      codesOf(() =>
        h.waitlist.add(lead, "offer-6", {
          accountId: o.id,
          contactId: "nope",
          reason: "Offer 6 is full",
        }),
      ),
    ).toContain("unknown_contact");
    expect(
      codesOf(() =>
        h.waitlist.add(lead, "offer-99", { accountId: o.id, reason: "Offer 6 is full" }),
      ),
    ).toContain("unknown_offer");
    expect(() => h.waitlist.add(lead, "offer-6", { accountId: o.id, reason: "ab" })).toThrow();
    expect(
      codesOf(() =>
        h.waitlist.add(lead, "offer-6", {
          accountId: o.id,
          reason: "Patient SSN 123-45-6789 asked",
        }),
      ),
    ).toContain("phi_guard");
    expect(h.count("offer_waitlist_entry")).toBe(1);
  });

  it("releases or removes an entry once, with a reason, and keeps it in history", () => {
    const { h, o } = setup();
    const lead = h.actor("operator");
    const e = h.waitlist.add(lead, "offer-6", { accountId: o.id, reason: "Offer 6 is full" });
    expect(() => h.waitlist.close(lead, "offer-6", e.id, { state: "released" })).toThrow();
    const closed = h.waitlist.close(lead, "offer-6", e.id, {
      state: "released",
      reason: "A place opened",
    });
    expect(closed).toMatchObject({
      state: "released",
      closedBy: "operator-1",
      closedReason: "A place opened",
    });
    expect(h.waitlist.list(lead, "offer-6")).toEqual([]);
    expect(h.waitlist.list(lead, "offer-6", "all")).toHaveLength(1);
    expect(
      codesOf(() =>
        h.waitlist.close(lead, "offer-6", e.id, { state: "removed", reason: "Twice over" }),
      ),
    ).toContain("already_closed");
    expect(
      codesOf(() =>
        h.waitlist.close(lead, "offer-6", "nope", { state: "removed", reason: "Nothing here" }),
      ),
    ).toContain("unknown_entry");
    expect(
      codesOf(() =>
        h.waitlist.close(lead, "offer-1", e.id, { state: "removed", reason: "Wrong offer" }),
      ),
    ).toContain("unknown_entry");
  });

  it("needs waitlist.edit to change it and offers.read to see it, and audits each refusal", () => {
    const { h, o } = setup();
    for (const who of ["analyst", "executive", "marketing"] as const) {
      expect(
        codesOf(() =>
          h.waitlist.add(h.actor(who), "offer-6", { accountId: o.id, reason: "Offer 6 is full" }),
        ),
        who,
      ).toContain("forbidden");
    }
    const e = h.waitlist.add(h.actor("operator"), "offer-6", {
      accountId: o.id,
      reason: "Offer 6 is full",
    });
    expect(
      codesOf(() =>
        h.waitlist.close(h.actor("analyst"), "offer-6", e.id, {
          state: "removed",
          reason: "Not allowed",
        }),
      ),
    ).toContain("forbidden");
    expect(h.waitlist.list(h.actor("executive"), "offer-6")).toHaveLength(1);
    expect(codesOf(() => h.waitlist.list(h.actor("marketing"), "offer-6"))).toContain("forbidden");
    expect(h.audit("offer.waitlist.add.refused")).toHaveLength(3);
    expect(h.audit("offer.waitlist.close.refused")).toHaveLength(1);
  });
});
