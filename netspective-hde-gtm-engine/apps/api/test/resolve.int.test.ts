import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T041 (research R-11): resolving the account and contact for a form submission.
const SLUG = "ccda-to-fhir-mapping-decision-register";
let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  const who = (id: string) => ({
    userId: id,
    actorType: "human" as const,
    correlationId: null,
    permissions: FOUNDATION_ROLE_PERMISSIONS.campaign_approver,
    now: () => fx.clock.now,
  });
  const v = fx.engagement.notices.create(who("author"), {
    noticeText: "We use your details to send the register and nothing else.",
    consentText: "I agree to be contacted.",
  });
  fx.engagement.notices.approve(who("approver"), v.id);
});
afterEach(async () => {
  await fx.app.close();
});
async function submit(
  email: string,
  orgName = "Newco HIE",
  orgType = "health_information_exchange",
) {
  const form = (
    await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
  ).json();
  fx.clock.now = new Date(fx.clock.now.getTime() + 5000);
  const res = await fx.app.inject({
    method: "POST",
    url: `/api/v1/public/offers/${SLUG}/requests`,
    payload: {
      kind: "download",
      formToken: form.formToken,
      noticeVersionId: form.notice.versionId,
      consentToContact: true,
      website: "",
      contact: { email, role: "Lead", orgName, orgType },
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().requestId as string;
}
const count = (table: string, where = "1=1") =>
  (fx.db.raw.prepare(`SELECT count(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c;
const account = (
  id: string,
  name: string,
  domain: string,
  shared = 0,
  mergedInto: string | null = null,
) => {
  const at = fx.clock.now.toISOString();
  fx.db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, merged_into, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    )
    .run(id, name, name.toLowerCase(), mergedInto, at, at);
  fx.db.raw
    .prepare(
      "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES (?,?,?,?)",
    )
    .run(`cl-${id}`, id, "health_information_exchange", at);
  fx.db.raw
    .prepare(
      "INSERT INTO account_domain (id, account_id, domain, is_shared, created_at) VALUES (?,?,?,?,?)",
    )
    .run(`d-${id}`, id, domain, shared, at);
};

describe("resolving a form submission", () => {
  it("matches an existing account by its domain whatever the case, and does not create another", async () => {
    account("acc-1", "Northvale HIE", "northvale-hie.example");
    const id = await submit("Alex@NORTHVALE-HIE.example", "Something Else Entirely");
    expect(count("account")).toBe(1);
    expect(fx.db.raw.prepare("SELECT account_id FROM offer_request WHERE id = ?").get(id)).toEqual({
      account_id: "acc-1",
    });
  });
  it("never matches a shared domain by domain alone, so it creates an account", async () => {
    account("acc-shared", "Shared Host Health", "shared-host.example", 1);
    await submit("dana@shared-host.example", "Dana Clinic");
    expect(count("account")).toBe(2);
    expect(count("account", "name = 'Dana Clinic'")).toBe(1);
  });
  it("ignores an account that was merged away", async () => {
    account("acc-new", "New Name", "newco-hie.example");
    account("acc-old", "Old Name", "oldco.example", 0, "acc-new");
    await submit("dana@oldco.example", "Oldco");
    expect(count("account", "name = 'Oldco'")).toBe(1);
  });
  it("records the source and a consent-based basis for a new contact and leaves an existing contact's source alone", async () => {
    await submit("dana@newco-hie.example");
    expect(fx.db.raw.prepare("SELECT source, basis FROM contact_source").get()).toEqual({
      source: "first_party_form",
      basis: "consent",
    });
    fx.clock.now = new Date(fx.clock.now.getTime() + 120_000);
    await submit("dana@newco-hie.example");
    expect(count("contact_source")).toBe(1);
    expect(count("account_contact_relationship")).toBe(1);
  });
  it("gives a second person at the same organisation the same account and their own contact", async () => {
    await submit("dana@newco-hie.example");
    fx.clock.now = new Date(fx.clock.now.getTime() + 120_000);
    await submit("sam@newco-hie.example");
    expect(count("account")).toBe(1);
    expect(count("contact")).toBe(2);
  });
  it("writes one audit event per accepted submission, with the kind and flags and no personal text", async () => {
    const id = await submit("dana@newco-hie.example");
    const events = fx.db.raw
      .prepare(
        "SELECT after_summary, entity_id FROM audit_event WHERE action = 'offer_request.receive'",
      )
      .all() as { after_summary: string; entity_id: string }[];
    expect(events).toHaveLength(1);
    expect(events[0]?.entity_id).toBe(id);
    expect(events[0]?.after_summary).not.toMatch(/dana|newco/i);
  });
});
