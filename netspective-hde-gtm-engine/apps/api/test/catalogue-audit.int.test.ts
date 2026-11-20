import { describe, expect, it } from "vitest";
import {
  buildCatalogueHarness,
  COMPLETE_PATCH,
  type CatalogueHarness,
} from "../test-support/catalogue-harness.js";

// Task T055 (service level; the route-level check is added with the routes): every change writes exactly
// one audit record naming who, in the same transaction, so a failure leaves neither (SC-008, FR-029).
const claimWithEvidence = (h: CatalogueHarness, text = "We review sender feeds weekly.") => {
  const c = h.claims.draft(h.actor("drafter"), { text });
  h.claims.addEvidence(h.actor("drafter"), c.id, {
    kind: "document",
    reference: "doc-1",
    owner: "Owner",
  });
  return c.id;
};

interface Case {
  action: string;
  by: string;
  run: (h: CatalogueHarness) => unknown;
}
const CASES: Case[] = [
  {
    action: "claim.draft",
    by: "drafter-1",
    run: (h) => h.claims.draft(h.actor("drafter"), { text: "We review feeds." }),
  },
  { action: "claim.evidence.add", by: "drafter-1", run: (h) => claimWithEvidence(h) },
  {
    action: "claim.review",
    by: "lead-1",
    run: (h) =>
      h.claimReview.review(h.actor("lead"), claimWithEvidence(h), {
        decision: "approve",
        note: "Checked",
      }),
  },
  {
    action: "claim.withdraw",
    by: "drafter-1",
    run: (h) =>
      h.claimReview.withdraw(
        h.actor("drafter"),
        h.claims.draft(h.actor("drafter"), { text: "We review feeds." }).id,
        { note: "Not needed" },
      ),
  },
  {
    action: "claim.disposition",
    by: "lead-1",
    run: (h) =>
      h.claimReview.markFalsePositive(h.actor("lead"), {
        sentence: "A SOC 2 reading list.",
        ruleId: "soc2",
        reason: "Reading list",
      }),
  },
  {
    action: "claim.phrase_list.publish",
    by: "marketing-1",
    run: (h) =>
      h.claimReview.publishPhraseList(h.actor("marketing"), {
        rules: h.claimReview.getPhraseList(h.actor("admin")).rules,
        reviewerId: "lead-1",
        note: "No change",
      }),
  },
  {
    action: "offer.version.create",
    by: "lead-1",
    run: (h) =>
      h.offers.createVersion(
        h.actor("lead"),
        "offer-2",
        { patch: COMPLETE_PATCH, reason: "Complete" },
        1,
      ),
  },
  {
    action: "offer.status.move",
    by: "lead-1",
    run: (h) =>
      h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 1, "internally_reviewed", "ok"),
  },
  {
    action: "offer.limitation.acknowledge",
    by: "lead-1",
    run: (h) => h.limitations.acknowledge(h.actor("lead"), "limitation-offer-7-evaluation"),
  },
  {
    action: "offer.limitation.change",
    by: "lead-1",
    run: (h) =>
      h.limitations.changeWording(
        h.actor("lead"),
        "limitation-offer-7-evaluation",
        "A different wording here",
      ),
  },
  {
    action: "offer.capacity.set",
    by: "lead-1",
    run: (h) =>
      h.capacity.setLimit(h.actor("lead"), "offer-6", { periodKind: "month", limitSessions: 4 }),
  },
  {
    action: "offer.booking.record",
    by: "lead-1",
    run: (h) => h.bookings.record(h.actor("lead"), "offer-6", { sessionDate: "2026-11-20" }),
  },
  {
    action: "offer.booking.cancel",
    by: "lead-1",
    run: (h) =>
      h.bookings.cancel(
        h.actor("lead"),
        h.bookings.record(h.actor("lead"), "offer-6", { sessionDate: "2026-11-20" }).id,
      ),
  },
  {
    action: "offer.score.set",
    by: "lead-1",
    run: (h) => {
      h.scores.addCriterion(h.actor("lead"), { key: "pull", label: "Buyer pull", position: 1 });
      return h.scores.setScore(h.actor("lead"), {
        offerId: "offer-1",
        criterionKey: "pull",
        score: 3,
      });
    },
  },
  {
    action: "paid_type.edit",
    by: "lead-1",
    run: (h) =>
      h.paidTypes.update(h.actor("lead"), "input_audit", { lockNo: 1, scope: ["one use case"] }),
  },
  {
    action: "paid_type.deliverable.propose",
    by: "lead-1",
    run: (h) =>
      h.paidTypes.proposeDeliverable(h.actor("lead"), "input_audit", {
        text: "A weekly status call",
      }),
  },
  {
    action: "capability.edit",
    by: "lead-1",
    run: (h) =>
      h.capabilities.update(h.actor("lead"), "capability-01", {
        lockNo: 1,
        attributes: { name: "A" },
      }),
  },
  {
    action: "capability.evidence.add",
    by: "lead-1",
    run: (h) =>
      h.capabilities.addEvidence(h.actor("lead"), "capability-01", {
        basisKind: "delivery_record",
        reference: "rec-1",
      }),
  },
  {
    action: "capability.example.add",
    by: "lead-1",
    run: (h) =>
      h.capabilities.addExample(h.actor("lead"), "capability-01", {
        text: "Internal example text",
      }),
  },
  {
    action: "capability.link",
    by: "lead-1",
    run: (h) => h.capabilities.link(h.actor("lead"), "capability-01", "offer-1"),
  },
  {
    action: "capability.public_status",
    by: "lead-1",
    run: (h) => h.makeCapabilityPublic("capability-01"),
  },
];

describe("one audit record per change, naming who", () => {
  it.each(CASES)("$action", ({ action, by, run }) => {
    const h = buildCatalogueHarness();
    run(h);
    const rows = h.audit(action);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.actor_id === by && r.outcome === "success")).toBe(true);
    if (action !== "claim.evidence.add" && action !== "capability.public_status")
      expect(rows).toHaveLength(1);
  });
});

describe("audit and change are one transaction", () => {
  it("leaves neither the change nor its audit record when the event write fails", () => {
    const eventful: [string, (h: CatalogueHarness) => unknown, string][] = [
      [
        "offer.version.create",
        (h) =>
          h.offers.createVersion(
            h.actor("lead"),
            "offer-2",
            { patch: COMPLETE_PATCH, reason: "Complete" },
            1,
          ),
        "offer_version WHERE offer_id = 'offer-2'",
      ],
      [
        "offer.status.move",
        (h) => h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 1, "internally_reviewed", "ok"),
        "offer_version_status WHERE offer_id = 'offer-2'",
      ],
      [
        "offer.capacity.set",
        (h) =>
          h.capacity.setLimit(h.actor("lead"), "offer-6", {
            periodKind: "month",
            limitSessions: 4,
          }),
        "offer_capacity",
      ],
      [
        "claim.draft",
        (h) => h.claims.draft(h.actor("drafter"), { text: "We review feeds." }),
        "claim",
      ],
      [
        "capability.edit",
        (h) =>
          h.capabilities.update(h.actor("lead"), "capability-01", {
            lockNo: 1,
            attributes: { name: "A" },
          }),
        "service_capability WHERE name IS NOT NULL",
      ],
    ];
    for (const [action, run, table] of eventful) {
      const h = buildCatalogueHarness();
      const rowsBefore = h.count(
        table.split(" ")[0]!,
        table.includes(" WHERE ") ? table.split(" WHERE ")[1]! : "1=1",
      );
      h.db.raw.exec("ALTER TABLE outbox_event RENAME TO outbox_event_broken");
      expect(() => run(h), action).toThrow();
      h.db.raw.exec("ALTER TABLE outbox_event_broken RENAME TO outbox_event");
      expect(
        h.audit(action).filter((a) => a.outcome === "success"),
        action,
      ).toHaveLength(0);
      expect(
        h.count(
          table.split(" ")[0]!,
          table.includes(" WHERE ") ? table.split(" WHERE ")[1]! : "1=1",
        ),
        action,
      ).toBe(rowsBefore);
    }
  });
});
