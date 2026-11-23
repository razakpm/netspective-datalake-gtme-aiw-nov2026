import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T057 (quickstart V28): the 30-minute working session request, separate from any download.
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
const count = (table: string, where = "1=1") =>
  (fx.db.raw.prepare(`SELECT count(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c;
async function submit(
  kind: "download" | "working_session",
  extra: Record<string, unknown> = {},
  email = "dana@newco-hie.example",
) {
  const form = (
    await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
  ).json();
  fx.clock.now = new Date(fx.clock.now.getTime() + 5000);
  return fx.app.inject({
    method: "POST",
    url: `/api/v1/public/offers/${SLUG}/requests`,
    payload: {
      kind,
      formToken: form.formToken,
      noticeVersionId: form.notice.versionId,
      consentToContact: true,
      website: "",
      contact: {
        email,
        role: "Lead",
        orgName: "Newco HIE",
        orgType: "health_information_exchange",
      },
      ...extra,
    },
  });
}
const five = [
  "Which OBX segment carries results?",
  "How do we map the encounter class?",
  "Where do allergies land in FHIR?",
  "Do we keep the original document?",
  "How are repeating sections ordered?",
];

describe("working session requests", () => {
  it("queues a request with five decisions for review, with no download and nothing sent", async () => {
    const res = await submit("working_session", { decisions: five });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "received" });
    expect(res.json().download).toBeUndefined();
    const row = fx.db.raw.prepare("SELECT kind, state, details_json FROM offer_request").get() as {
      kind: string;
      state: string;
      details_json: string;
    };
    expect(row).toMatchObject({ kind: "working_session", state: "received" });
    expect(JSON.parse(row.details_json)).toEqual({ decisions: five });
    expect(count("lead_magnet_download")).toBe(0);
    expect(count("offer_recommendation")).toBe(0);
    expect(count("consent_record")).toBe(1);
    expect(
      fx.db.raw
        .prepare(
          "SELECT DISTINCT type FROM outbox_event WHERE type LIKE 'offer.%' OR type LIKE 'lead_%'",
        )
        .all(),
    ).toEqual([{ type: "offer.requested" }]);
  });

  it("handles a personal email and consent the same way as a download", async () => {
    const res = await submit("working_session", { decisions: five.slice(0, 2) }, "pat@gmail.com");
    expect(res.json().flags).toEqual(["personal_email"]);
    expect(count("account")).toBe(0);
    expect(count("contact")).toBe(0);
  });

  it("refuses six decisions, an over-long one, a blank list and patient-like text, storing nothing", async () => {
    const refusals = [
      await submit("working_session", { decisions: [...five, "A sixth open decision"] }),
      await submit("working_session", { decisions: ["x".repeat(301)] }),
      await submit("working_session", { decisions: [] }),
      await submit("working_session", { decisions: ["Patient SSN 123-45-6789 mapping question"] }),
    ];
    expect(refusals.map((r) => r.statusCode)).toEqual([422, 422, 422, 422]);
    expect(refusals[0]?.json().detail).toMatch(/five/i);
    expect(refusals[1]?.json().detail).toMatch(/300/);
    expect(count("offer_request")).toBe(0);
    expect(count("account")).toBe(0);
    expect(count("consent_record")).toBe(0);
  });

  it("keeps the download and the session as distinct records so conversion can be read from them (V28, SC-009)", async () => {
    await submit("download");
    fx.clock.now = new Date(fx.clock.now.getTime() + 120_000);
    await submit("working_session", { decisions: five.slice(0, 1) });
    fx.clock.now = new Date(fx.clock.now.getTime() + 120_000);
    await submit("download", {}, "sam@othercorp-hie.example");
    const lead = {
      userId: "u",
      actorType: "human" as const,
      correlationId: null,
      permissions: FOUNDATION_ROLE_PERMISSIONS.gtm_operator,
      now: () => fx.clock.now,
    };
    const rows = fx.engagement.requests.conversion(lead);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.downloads === 1 && r.sessionRequests === 1)).toMatchObject({
      sessionAfterDownload: true,
    });
    expect(rows.find((r) => r.sessionRequests === 0)).toMatchObject({
      downloads: 1,
      sessionAfterDownload: false,
    });
    expect(count("lead_magnet_download")).toBe(2);
    expect(count("offer_request", "kind = 'working_session'")).toBe(1);
  });

  it("lets an operator link a session request to the account and contact", async () => {
    const id = (await submit("working_session", { decisions: five.slice(0, 1) })).json()
      .requestId as string;
    const detail = fx.engagement.requests.get(
      {
        userId: "u",
        actorType: "human",
        correlationId: null,
        permissions: FOUNDATION_ROLE_PERMISSIONS.gtm_operator,
        now: () => fx.clock.now,
      },
      id,
    );
    expect(detail).toMatchObject({
      kind: "working_session",
      decisions: five.slice(0, 1),
      download: null,
    });
    const linked = fx.engagement.requests.review(
      {
        userId: "u",
        actorType: "human",
        correlationId: null,
        permissions: FOUNDATION_ROLE_PERMISSIONS.gtm_operator,
        now: () => fx.clock.now,
      },
      id,
      { action: "link" },
    );
    expect(linked.state).toBe("linked");
  });
});
