import { describe, expect, it } from "vitest";
import { loadRequestForWorkshop } from "../src/modules/engagement/index.js";
import { buildWorkshopsHarness, FIELD_NAMES } from "../test-support/workshops-harness.js";

// Feature 007 task T020: the harness makes linked intake requests through the real request service.
describe("workshops harness", () => {
  it("creates a linked Offer 1 and Offer 6 intake request", async () => {
    const h = buildWorkshopsHarness();
    for (const [offer, kind] of [
      [1, "offer_1"],
      [6, "offer_6"],
    ] as const) {
      const made = await h.linkedIntake(offer);
      expect(loadRequestForWorkshop(h.db.raw, made.requestId)).toMatchObject({
        state: "linked",
        kind: "intake",
        offerId: `offer-${offer}`,
        accountId: h.account(offer).id,
        contactId: made.contactId,
        intake: { kind },
      });
    }
    expect(
      JSON.stringify(h.db.raw.prepare("SELECT payload_json FROM intake_submission").all()),
    ).toContain(FIELD_NAMES[0]);
  });
});
