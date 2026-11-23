import { FOUNDATION_ROLE_PERMISSIONS, type RoleKey } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T040: notice versions and consent records (feature 006, spec FR-017, research R-09).
let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});
const who = (id: string, role: RoleKey) => ({
  userId: id,
  actorType: "human" as const,
  correlationId: "corr",
  permissions: FOUNDATION_ROLE_PERMISSIONS[role],
  now: () => fx.clock.now,
});
const TEXT = {
  noticeText:
    "We use your details to send the register and, only if you agree, to contact you about it.",
  consentText: "I agree to be contacted about this topic.",
};
const codesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    return (e as { codes?: string[] }).codes ?? [];
  }
  return [];
};

describe("notice versions", () => {
  it("are created by notices.manage, numbered, and not served until approved", () => {
    const n = fx.engagement.notices;
    expect(n.currentApproved()).toBeNull();
    const v1 = n.create(who("author", "campaign_approver"), TEXT);
    expect(v1).toMatchObject({ version: 1, approvedBy: null });
    expect(n.currentApproved()).toBeNull();
    expect(n.create(who("author", "campaign_approver"), TEXT).version).toBe(2);
  });

  it("are approved once, by someone other than the author, and then served", () => {
    const n = fx.engagement.notices;
    const v = n.create(who("author", "campaign_approver"), TEXT);
    expect(codesOf(() => n.approve(who("author", "campaign_approver"), v.id))).toContain(
      "author_cannot_approve",
    );
    expect(n.currentApproved()).toBeNull();
    const approved = n.approve(who("approver", "campaign_approver"), v.id);
    expect(approved).toMatchObject({ approvedBy: "approver" });
    expect(n.currentApproved()?.id).toBe(v.id);
    expect(codesOf(() => n.approve(who("approver2", "campaign_approver"), v.id))).toContain(
      "already_approved",
    );
    expect(codesOf(() => n.approve(who("approver", "campaign_approver"), "nope"))).toContain(
      "unknown_notice_version",
    );
  });

  it("serve the latest approved version and never change text once written", () => {
    const n = fx.engagement.notices;
    const a = n.create(who("author", "campaign_approver"), TEXT);
    n.approve(who("approver", "campaign_approver"), a.id);
    const b = n.create(who("author", "campaign_approver"), {
      ...TEXT,
      consentText: "I agree to hear from you about the register.",
    });
    expect(n.currentApproved()?.id).toBe(a.id);
    n.approve(who("approver", "campaign_approver"), b.id);
    expect(n.currentApproved()?.id).toBe(b.id);
    expect(n.approvedById(a.id)?.id).toBe(a.id);
    expect(() =>
      fx.db.raw.prepare("UPDATE notice_version SET notice_text = 'x' WHERE id = ?").run(a.id),
    ).toThrow(/never changes/);
  });

  it("need the right permission, refuse PHI-like text and short wording, and audit refusals", () => {
    const n = fx.engagement.notices;
    for (const role of ["gtm_operator", "research_analyst", "read_only_executive"] as RoleKey[]) {
      expect(
        codesOf(() => n.create(who("u", role), TEXT)),
        role,
      ).toContain("forbidden");
    }
    const v = n.create(who("author", "campaign_approver"), TEXT);
    expect(codesOf(() => n.approve(who("lead", "sales_service_lead"), v.id))).toContain(
      "forbidden",
    );
    expect(
      codesOf(() =>
        n.create(who("author", "campaign_approver"), {
          ...TEXT,
          noticeText: "Patient SSN 123-45-6789 is held by us here.",
        }),
      ),
    ).toContain("phi_guard");
    expect(() =>
      n.create(who("author", "campaign_approver"), { noticeText: "short", consentText: "short" }),
    ).toThrow();
    expect(
      (
        fx.db.raw.prepare("SELECT count(*) c FROM audit_event WHERE outcome = 'denied'").get() as {
          c: number;
        }
      ).c,
    ).toBeGreaterThanOrEqual(5);
    expect(
      (
        fx.db.raw
          .prepare(
            "SELECT count(*) c FROM audit_event WHERE action IN ('notice.create','notice.approve')",
          )
          .get() as { c: number }
      ).c,
    ).toBe(1);
  });
});

describe("consent records", () => {
  it("are append-only, and the latest row decides the current permission", async () => {
    const n = fx.engagement.notices;
    const v = n.create(who("author", "campaign_approver"), TEXT);
    n.approve(who("approver", "campaign_approver"), v.id);
    const at = fx.clock.now.toISOString();
    fx.db.raw
      .prepare(
        "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a1','Acme','acme',?,?)",
      )
      .run(at, at);
    fx.db.raw
      .prepare(
        "INSERT INTO contact (id, business_email, email_hash, created_at, updated_at) VALUES ('c1','a@acme.example','h1',?,?)",
      )
      .run(at, at);
    const offer = (
      fx.db.raw
        .prepare(
          "SELECT id FROM engagement_offer WHERE key = 'ccda-to-fhir-mapping-decision-register'",
        )
        .get() as { id: string }
    ).id;
    const request = (id: string, t: string) =>
      fx.db.raw
        .prepare(
          "INSERT INTO offer_request (id, offer_id, form_slug, kind, email_hash, submitted_at) VALUES (?,?,'ccda-to-fhir-mapping-decision-register','download','h1',?)",
        )
        .run(id, offer, t);
    const consent = (id: string, requestId: string, given: number, t: string) =>
      fx.db.raw
        .prepare(
          "INSERT INTO consent_record (id, request_id, contact_id, email_hash, notice_version_id, consent_given, recorded_at) VALUES (?,?,'c1','h1',?,?,?)",
        )
        .run(id, requestId, v.id, given, t);
    const lookup = fx.engagement.consent;
    expect(lookup.latest({ contactId: "c1", emailHash: "h1" })).toBe("none");
    request("q1", "2026-11-01T00:00:00.000Z");
    consent("k1", "q1", 1, "2026-11-01T00:00:00.000Z");
    expect(lookup.latest({ contactId: "c1", emailHash: null })).toBe("given");
    request("q2", "2026-11-02T00:00:00.000Z");
    consent("k2", "q2", 0, "2026-11-02T00:00:00.000Z");
    expect(lookup.latest({ contactId: "c1", emailHash: null })).toBe("not_given");
    expect(lookup.latest({ contactId: null, emailHash: "h1" })).toBe("not_given");
    expect(() =>
      fx.db.raw.prepare("UPDATE consent_record SET consent_given = 1 WHERE id = 'k2'").run(),
    ).toThrow(/append-only/);
    expect(() => fx.db.raw.prepare("DELETE FROM consent_record WHERE id = 'k1'").run()).toThrow(
      /append-only/,
    );
  });
});
