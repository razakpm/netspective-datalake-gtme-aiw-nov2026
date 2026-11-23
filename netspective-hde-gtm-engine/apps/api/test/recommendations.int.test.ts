import { describe, expect, it } from "vitest";
import { buildOffersHarness } from "../test-support/offers-harness.js";

// Task T031 (quickstart V1 to V12): recommendations through the real services on the synthetic organisations.
const codesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    return (e as { codes?: string[] }).codes ?? [];
  }
  return [];
};
const O1 = "sender-onboarding-friction-map";
const O5 = "ccda-to-fhir-mapping-decision-register";
const O6 = "pilot-input-trace-workshop";

function setup() {
  const h = buildOffersHarness();
  const op = h.actor("operator");
  const northvale = () => {
    const o = h.org("northvale", [["sender_onboarding_friction", "observed"]]);
    const c = h.contact(o.id, "alex@northvale-hie.example", { consent: "given" });
    return { o, c };
  };
  const riverbend = () => {
    const o = h.org("riverbend", [
      ["mid_size_judgement", "derived_interpretation"],
      ["stalled_ai_pilot", "buyer_confirmed"],
    ]);
    const c = h.contact(o.id, "casey@riverbend-health.example", { consent: "given" });
    return { o, c };
  };
  return { h, op, northvale, riverbend };
}

describe("recommendations", () => {
  it("V1: Offer 1 for ICP 1 with a supported onboarding hypothesis, with explanation, limitations and the rule set version", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    h.hypothesis(o.id, "onboarding_friction");
    const r = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(r).toMatchObject({
      outcome: "offer",
      offerKey: O1,
      outreach: "allowed",
      ruleSetVersion: 1,
      reviewState: "pending",
      outOfDate: false,
    });
    expect(r.matched.map((m) => m.ruleId)).toEqual(["icp1-onboarding-friction"]);
    expect(r.explanation.length).toBeGreaterThan(0);
    expect(r.explanation.length).toBeLessThanOrEqual(600);
    expect(r.explanation).toContain("icp1-onboarding-friction");
    expect(Array.isArray(r.limitations)).toBe(true);
    expect(r.aiUsed).toBe(false);
  });

  it("V2: Offer 6 for ICP 2 with a supported pilot input hypothesis", async () => {
    const { h, op, riverbend } = setup();
    const { o, c } = riverbend();
    h.hypothesis(o.id, "pilot_input_quality");
    const r = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(r).toMatchObject({ outcome: "offer", offerKey: O6 });
    expect(r.matched[0]?.ruleId).toBe("icp2-pilot-input");
  });

  it("V3: Offer 5 for a supported CCDA-to-FHIR hypothesis with no stronger match, and says Offer 5 has no capacity limit", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    h.hypothesis(o.id, "capability_gap", { capabilities: ["ccda_to_fhir_mapping"] });
    const r = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(r).toMatchObject({ outcome: "offer", offerKey: O5 });
    expect(r.matched.map((m) => m.ruleId)).toEqual(["ccda-fhir-decisions"]);
    expect(r.limitations.join(" ")).toContain("no capacity limit");
  });

  it("V4: a multi-format gap in two categories gives Offer 1 for ICP 1 and Offer 6 for ICP 2", async () => {
    const { h, op, northvale, riverbend } = setup();
    const n = northvale();
    h.hypothesis(n.o.id, "data_quality", { capabilities: ["multi_format_intake"] });
    h.hypothesis(n.o.id, "platform_architecture", { capabilities: ["multi_format_intake"] });
    expect(
      (await h.recommendations.recommend(op, { accountId: n.o.id, contactId: n.c.id })).offerKey,
    ).toBe(O1);
    const r = riverbend();
    h.hypothesis(r.o.id, "data_quality", { capabilities: ["multi_format_intake"] });
    h.hypothesis(r.o.id, "platform_architecture", { capabilities: ["multi_format_intake"] });
    const rr = await h.recommendations.recommend(op, { accountId: r.o.id, contactId: r.c.id });
    expect(rr.offerKey).toBe(O6);
    expect(rr.matched.map((m) => m.ruleId)).toEqual(["multi-format-gap"]);
  });

  it("V5: weak, stale and rejected hypotheses give research, and never propose an automatic email", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    for (const status of ["weakening", "stale", "rejected"]) {
      const id = h.hypothesis(o.id, "onboarding_friction", { status });
      const r = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
      expect(r).toMatchObject({ outcome: "research", offerKey: null });
      expect(r.explanation.toLowerCase()).not.toContain("email");
      h.db.raw.prepare("DELETE FROM account_hypothesis WHERE id = ?").run(id);
    }
    const sc = h.org("summitcare", [
      ["mid_size_judgement", "derived_interpretation"],
      ["generic_ai_interest", "observed"],
    ]);
    expect((await h.recommendations.recommend(op, { accountId: sc.id })).outcome).toBe("research");
  });

  it("V6: an excluded organisation gets no action and outreach is blocked", async () => {
    const { h, op } = setup();
    const o = h.org("helixbio");
    const r = await h.recommendations.recommend(op, { accountId: o.id });
    expect(r).toMatchObject({
      outcome: "no_action",
      outreach: "blocked",
      blockedReasons: ["account_excluded"],
    });
  });

  it("V7: a suppressed contact blocks outreach and no model is ever called, even with the AI step on", async () => {
    const h = buildOffersHarness({ recommendationAi: true });
    const op = h.actor("operator");
    const o = h.org("northvale", [["sender_onboarding_friction", "observed"]]);
    const c = h.contact(
      o.id,
      "pat.unsubscribed@example.org".replace("example.org", "northvale-hie.example"),
      { consent: "given" },
    );
    h.hypothesis(o.id, "onboarding_friction");
    h.suppression.add(h.actor("operator"), {
      scope: "contact",
      contactId: c.id,
      reason: "Unsubscribed",
    });
    const r = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(r).toMatchObject({
      outcome: "no_action",
      outreach: "blocked",
      blockedReasons: ["contact_suppressed"],
    });
    expect(h.llm.calls).toHaveLength(0);
  });

  it("V7: an account-level suppression blocks outreach for a different contact and for no contact", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    h.suppression.add(h.actor("operator"), {
      scope: "account",
      accountId: o.id,
      reason: "Account asked to stop",
    });
    expect(
      (await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id })).blockedReasons,
    ).toEqual(["contact_suppressed"]);
    expect((await h.recommendations.recommend(op, { accountId: o.id })).blockedReasons).toEqual([
      "contact_suppressed",
    ]);
  });

  it("V8: a refusal or withdrawal of consent blocks outreach; no record but a permitted basis allows it", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    h.hypothesis(o.id, "onboarding_friction");
    h.consent.set(c.id, "not_given");
    expect(
      await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id }),
    ).toMatchObject({
      outcome: "no_action",
      blockedReasons: ["no_communication_permission"],
    });
    h.consent.set(c.id, "none");
    expect(
      await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id }),
    ).toMatchObject({ outcome: "offer", outreach: "allowed" });
  });

  it("V9: every matching rule is listed, the lowest priority wins and the reason is given", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    h.hypothesis(o.id, "onboarding_friction");
    h.hypothesis(o.id, "capability_gap", { capabilities: ["ccda_to_fhir_mapping"] });
    const r = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(r.matched.map((m) => m.ruleId)).toEqual([
      "icp1-onboarding-friction",
      "ccda-fhir-decisions",
    ]);
    expect(r.offerKey).toBe(O1);
    expect(r.eligible.map((e) => e.offerKey)).toContain(O5);
  });

  it("V10: the same inputs and rule set version give the same eligible set and matches, and no duplicate is created", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    h.hypothesis(o.id, "onboarding_friction");
    const a = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    const again = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(again.id).toBe(a.id);
    expect(h.count("offer_recommendation")).toBe(1);
    h.recommendations.dismiss(op, a.id, { reason: "Not now" });
    const b = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(b.id).not.toBe(a.id);
    expect(b.eligible).toEqual(a.eligible);
    expect(b.matched).toEqual(a.matched);
  });

  it("V11: a recommendation shows as out of date when an input changes, and a new one leaves the old unchanged", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    const hid = h.hypothesis(o.id, "onboarding_friction");
    const a = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(h.recommendations.get(op, a.id).outOfDate).toBe(false);
    h.setHypothesisStatus(hid, "weakening");
    expect(h.recommendations.get(op, a.id).outOfDate).toBe(true);
    const b = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(b.outcome).toBe("research");
    const old = h.recommendations.get(op, a.id);
    expect(old).toMatchObject({ outcome: "offer", offerKey: O1, explanation: a.explanation });
  });

  it("V11: suppression and consent changes also make a recommendation out of date", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    h.hypothesis(o.id, "onboarding_friction");
    const a = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    h.consent.set(c.id, "not_given");
    expect(h.recommendations.get(op, a.id).outOfDate).toBe(true);
  });

  it("V12: accept sends nothing and is audited; dismissal needs a reason; a second review is refused", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    h.hypothesis(o.id, "onboarding_friction");
    const a = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    const types = () =>
      (h.db.raw.prepare("SELECT DISTINCT type FROM outbox_event").all() as { type: string }[]).map(
        (r) => r.type,
      );
    expect(types()).toEqual(["offer.recommended"]);
    const accepted = h.recommendations.accept(op, a.id);
    expect(accepted).toMatchObject({ reviewState: "accepted", reviewedBy: "operator-1" });
    expect(types()).toEqual(["offer.recommended"]);
    expect(h.audit("offer.recommendation.accept")).toHaveLength(1);
    expect(codesOf(() => h.recommendations.accept(op, a.id))).toContain("already_reviewed");
    h.hypothesis(o.id, "capability_gap", { capabilities: ["ccda_to_fhir_mapping"] });
    const b = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(() => h.recommendations.dismiss(op, b.id, {})).toThrow();
    expect(() => h.recommendations.dismiss(op, b.id, { reason: "ab" })).toThrow();
    expect(h.recommendations.dismiss(op, b.id, { reason: "Wrong time" })).toMatchObject({
      reviewState: "dismissed",
      reviewReason: "Wrong time",
    });
  });

  it("refuses to accept an offer that has just become full, and shows why", async () => {
    const { h, op, riverbend } = setup();
    const { o, c } = riverbend();
    h.hypothesis(o.id, "pilot_input_quality");
    const a = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(a.offerKey).toBe(O6);
    h.fillCapacity(h.offerId(6), 3);
    expect(codesOf(() => h.recommendations.accept(op, a.id))).toContain("capacity_exhausted");
    expect(h.recommendations.get(op, a.id).reviewState).toBe("pending");
  });

  it("records one audit event and one identifier-only event for each recommendation", async () => {
    const { h, op, northvale } = setup();
    const { o, c } = northvale();
    h.hypothesis(o.id, "onboarding_friction");
    const a = await h.recommendations.recommend(op, { accountId: o.id, contactId: c.id });
    expect(h.audit("offer.recommend")).toHaveLength(1);
    expect(h.outbox("offer.recommended")).toEqual([
      {
        recommendation_id: a.id,
        account_id: o.id,
        outcome: "offer",
        outreach: "allowed",
        rule_set_version: 1,
      },
    ]);
    expect(h.anyText(/alex@|Northvale HIE|explanation/)).toBe(false);
  });

  it("refuses a caller without offers.recommend, with an audited refusal", async () => {
    const { h, northvale } = setup();
    const { o } = northvale();
    await expect(
      h.recommendations.recommend(h.actor("analyst"), { accountId: o.id }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.audit("offer.recommend.refused").at(-1)?.outcome).toBe("denied");
    expect(h.count("offer_recommendation")).toBe(0);
  });

  it("refuses an unknown account", async () => {
    const { h, op } = setup();
    await expect(h.recommendations.recommend(op, { accountId: "nope" })).rejects.toMatchObject({
      status: 404,
    });
  });
});
