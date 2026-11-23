import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T042 (quickstart V18 to V27, Scenario C) over HTTP: the public form for the CCDA-to-FHIR register.
const SLUG = "ccda-to-fhir-mapping-decision-register";
let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});

const marketing = (id: string) => ({
  userId: id,
  actorType: "human" as const,
  correlationId: null,
  permissions: FOUNDATION_ROLE_PERMISSIONS.campaign_approver,
  now: () => fx.clock.now,
});
const approveNotice = () => {
  const draft = fx.engagement.notices.create(marketing("author-1"), {
    noticeText:
      "We use your details to send the register and, only if you agree, to contact you about it.",
    consentText: "I agree to be contacted about this topic.",
  });
  return fx.engagement.notices.approve(marketing("approver-1"), draft.id);
};
const advance = (seconds: number) => {
  fx.clock.now = new Date(fx.clock.now.getTime() + seconds * 1000);
};
const getForm = (slug = SLUG) =>
  fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${slug}/form` });
async function openForm(slug = SLUG) {
  const res = await getForm(slug);
  expect(res.statusCode).toBe(200);
  advance(5);
  return res.json() as { formToken: string; notice: { versionId: string } };
}
const contact = (over: Record<string, unknown> = {}) => ({
  email: "alex@northvale-hie.example",
  role: "Integration Lead",
  orgName: "Northvale HIE",
  orgType: "health_information_exchange",
  ...over,
});
const bodyFor = (
  form: { formToken: string; notice: { versionId: string } },
  over: Record<string, unknown> = {},
) => ({
  kind: "download",
  formToken: form.formToken,
  noticeVersionId: form.notice.versionId,
  consentToContact: true,
  website: "",
  contact: contact(),
  ...over,
});
const post = (body: unknown, slug = SLUG) =>
  fx.app.inject({
    method: "POST",
    url: `/api/v1/public/offers/${slug}/requests`,
    payload: body as object,
  });
const count = (table: string, where = "1=1") =>
  (fx.db.raw.prepare(`SELECT count(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c;

/** An organisation already on file with evidence, as the synthetic fixtures have. */
function knownOrg(
  id: string,
  name: string,
  orgType: string,
  domain: string,
  evidence: [string, string][],
) {
  const at = fx.clock.now.toISOString();
  fx.db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES (?,?,?,?,?)",
    )
    .run(id, name, name.toLowerCase(), at, at);
  fx.db.raw
    .prepare(
      "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES (?,?,?,?)",
    )
    .run(`cl-${id}`, id, orgType, at);
  fx.db.raw
    .prepare("INSERT INTO account_domain (id, account_id, domain, created_at) VALUES (?,?,?,?)")
    .run(`d-${id}`, id, domain, at);
  for (const [topic, status] of evidence) {
    fx.db.raw
      .prepare(
        "INSERT INTO evidence_reference (id, account_id, topic, what, where_ref, observed_at, recorded_at, status) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(`${id}-${topic}`, id, topic, "synthetic", "ref", at, at, status);
  }
}
const NORTHVALE: [string, string][] = [["sender_onboarding_friction", "observed"]];
const RIVERBEND: [string, string][] = [
  ["mid_size_judgement", "derived_interpretation"],
  ["stalled_ai_pilot", "buyer_confirmed"],
];

describe("the form", () => {
  it("is unavailable (503, plain message) until a notice version is approved (V19)", async () => {
    const res = await getForm();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ codes: ["no_notice"] });
    expect(res.json().detail).toMatch(/not available/i);
  });
  it("serves the approved notice, the fields and a token, with no cookie, and 404 for any other slug", async () => {
    approveNotice();
    const res = await getForm();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ slug: SLUG, kinds: ["download", "working_session"] });
    expect(res.json().notice.noticeText).toContain("register");
    expect(res.json().orgTypes.length).toBeGreaterThan(5);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await getForm("not-a-form")).statusCode).toBe(404);
  });
});

describe("protection against automated submissions (V18)", () => {
  beforeEach(() => {
    approveNotice();
  });
  const nothingCreated = () => {
    expect(count("offer_request")).toBe(0);
    expect(count("account")).toBe(0);
    expect(count("contact")).toBe(0);
    expect(count("consent_record")).toBe(0);
  };
  it("refuses a missing, tampered or foreign token with one plain message and creates nothing", async () => {
    const form = await openForm();
    for (const token of ["", "garbage", `${form.formToken}x`, form.formToken.replace(/.$/, "A")]) {
      const res = await post(bodyFor(form, { formToken: token || "short" }));
      expect(res.statusCode).toBe(400);
      expect(res.json().codes).toEqual(["form_rejected"]);
    }
    const other = await openForm("sender-onboarding-friction-map");
    expect((await post(bodyFor(other))).statusCode).toBe(400);
    nothingCreated();
  });
  it("refuses a filled honeypot field", async () => {
    const form = await openForm();
    expect((await post(bodyFor(form, { website: "http://spam.example" }))).statusCode).toBe(400);
    nothingCreated();
  });
  it("refuses a submission sent straight after the form was issued, and one sent far too late", async () => {
    approveNotice();
    const res = await getForm();
    const form = res.json();
    expect((await post(bodyFor(form))).statusCode).toBe(400);
    advance(25 * 3600);
    expect((await post(bodyFor(form))).statusCode).toBe(400);
    nothingCreated();
  });
  it("refuses a notice version that is not approved, and an unknown field", async () => {
    const form = await openForm();
    const draft = fx.engagement.notices.create(marketing("author-2"), {
      noticeText: "A newer notice that nobody has approved yet.",
      consentText: "I agree to be contacted again.",
    });
    expect((await post(bodyFor(form, { noticeVersionId: draft.id }))).statusCode).toBe(409);
    expect((await post(bodyFor(form, { price: "1000" }))).statusCode).toBe(400);
    nothingCreated();
  });
});

describe("Scenario C: the register download", () => {
  beforeEach(() => {
    approveNotice();
  });

  it("delivers the register, records the consent and a download, and queues an Offer 1 follow-up for an ICP 1 contact (V20)", async () => {
    knownOrg(
      "acc-northvale",
      "Northvale HIE",
      "health_information_exchange",
      "northvale-hie.example",
      NORTHVALE,
    );
    const form = await openForm();
    const res = await post(bodyFor(form));
    expect(res.statusCode).toBe(201);
    const receipt = res.json();
    expect(receipt).toMatchObject({ status: "received", flags: [], download: { delivered: true } });
    expect(receipt.download.url).toMatch(/^\/api\/v1\/public\/downloads\//);

    const request = fx.db.raw.prepare("SELECT * FROM offer_request").get() as Record<
      string,
      unknown
    >;
    expect(request).toMatchObject({
      kind: "download",
      state: "received",
      account_id: "acc-northvale",
      org_type: "health_information_exchange",
    });
    expect(count("account")).toBe(1);
    expect(fx.db.raw.prepare("SELECT source FROM contact_source").get()).toEqual({
      source: "first_party_form",
    });
    expect(
      fx.db.raw.prepare("SELECT consent_given, notice_version_id FROM consent_record").get(),
    ).toMatchObject({ consent_given: 1, notice_version_id: form.notice.versionId });
    expect(fx.db.raw.prepare("SELECT delivered FROM lead_magnet_download").get()).toEqual({
      delivered: 1,
    });

    const rec = fx.db.raw.prepare("SELECT * FROM offer_recommendation").get() as Record<
      string,
      unknown
    >;
    expect(rec).toMatchObject({
      trigger: "offer5_download",
      outcome: "offer",
      outreach: "allowed",
      review_state: "pending",
      request_id: request["id"],
    });
    expect(
      fx.db.raw
        .prepare("SELECT key FROM engagement_offer WHERE id = ?")
        .get(rec["offer_id"] as string),
    ).toEqual({ key: "sender-onboarding-friction-map" });
  });

  it("queues an Offer 6 follow-up for an ICP 2 contact (V21)", async () => {
    knownOrg(
      "acc-river",
      "Riverbend Health",
      "health_system",
      "riverbend-health.example",
      RIVERBEND,
    );
    const form = await openForm();
    const res = await post(
      bodyFor(form, {
        contact: contact({
          email: "casey@riverbend-health.example",
          orgName: "Riverbend Health",
          orgType: "health_system",
        }),
      }),
    );
    expect(res.statusCode).toBe(201);
    const rec = fx.db.raw.prepare("SELECT offer_id FROM offer_recommendation").get() as {
      offer_id: string;
    };
    expect(
      fx.db.raw.prepare("SELECT key FROM engagement_offer WHERE id = ?").get(rec.offer_id),
    ).toEqual({ key: "pilot-input-trace-workshop" });
  });

  it("records a download as first-party engagement, never as intent or a qualified lead, and sends nothing (V22)", async () => {
    knownOrg(
      "acc-northvale",
      "Northvale HIE",
      "health_information_exchange",
      "northvale-hie.example",
      NORTHVALE,
    );
    const form = await openForm();
    await post(bodyFor(form));
    const columns = (t: string) =>
      (fx.db.raw.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[])
        .map((c) => c.name)
        .join(",");
    for (const t of ["lead_magnet_download", "offer_request", "consent_record"])
      expect(columns(t)).not.toMatch(/intent|qualif|sql|score/i);
    const types = (
      fx.db.raw.prepare("SELECT DISTINCT type FROM outbox_event").all() as { type: string }[]
    )
      .map((r) => r.type)
      .sort();
    expect(types).toEqual(
      [
        "contact.identified",
        "lead_magnet.downloaded",
        "offer.recommended",
        "offer.requested",
      ].filter((t) => types.includes(t)),
    );
    expect(types).toEqual(
      expect.arrayContaining(["lead_magnet.downloaded", "offer.recommended", "offer.requested"]),
    );
    expect(fx.fakeLlm.calls).toHaveLength(0);
    const events = fx.db.raw
      .prepare(
        "SELECT payload FROM outbox_event WHERE type IN ('offer.requested','lead_magnet.downloaded')",
      )
      .all() as { payload: string }[];
    expect(JSON.stringify(events)).not.toMatch(/alex|northvale-hie\.example|register|http/i);
  });

  it("creates the account and contact for a new organisation, with the source recorded, and reuses them next time", async () => {
    const form = await openForm();
    await post(
      bodyFor(form, {
        contact: contact({ email: "dana@newco-hie.example", orgName: "Newco HIE" }),
      }),
    );
    expect(count("account")).toBe(1);
    expect(count("contact")).toBe(1);
    expect(fx.db.raw.prepare("SELECT source, basis FROM contact_source").get()).toEqual({
      source: "first_party_form",
      basis: "consent",
    });
    // New account with no evidence: fit is unknown, so research and no outreach, until evidence is recorded.
    expect(fx.db.raw.prepare("SELECT outcome, outreach FROM offer_recommendation").get()).toEqual({
      outcome: "research",
      outreach: "blocked",
    });
    advance(120);
    const again = await openForm();
    expect(
      (
        await post(
          bodyFor(again, {
            contact: contact({ email: "dana@newco-hie.example", orgName: "Newco HIE" }),
          }),
        )
      ).statusCode,
    ).toBe(201);
    expect(count("account")).toBe(1);
    expect(count("contact")).toBe(1);
    expect(count("offer_request")).toBe(2);
    expect(count("lead_magnet_download")).toBe(2);
    expect(count("offer_recommendation")).toBe(1);
  });

  it("still delivers and records without consent, and recommends no outreach, saying why (V23)", async () => {
    knownOrg(
      "acc-northvale",
      "Northvale HIE",
      "health_information_exchange",
      "northvale-hie.example",
      NORTHVALE,
    );
    const form = await openForm();
    const res = await post(bodyFor(form, { consentToContact: false }));
    expect(res.json().download.delivered).toBe(true);
    expect(fx.db.raw.prepare("SELECT consent_given FROM consent_record").get()).toEqual({
      consent_given: 0,
    });
    expect(
      JSON.parse(
        (fx.db.raw.prepare("SELECT flags_json f FROM offer_request").get() as { f: string }).f,
      ),
    ).toContain("no_consent");
    expect(
      fx.db.raw
        .prepare("SELECT outcome, outreach, blocked_reasons_json b FROM offer_recommendation")
        .get(),
    ).toMatchObject({
      outcome: "no_action",
      outreach: "blocked",
      b: '["no_communication_permission"]',
    });
  });

  it("accepts a personal email, flags it and creates no account or contact, but still checks suppression (V24)", async () => {
    const form = await openForm();
    const res = await post(bodyFor(form, { contact: contact({ email: "pat.private@gmail.com" }) }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ flags: ["personal_email"], download: { delivered: true } });
    expect(count("account")).toBe(0);
    expect(count("contact")).toBe(0);
    expect(count("offer_recommendation")).toBe(0);
    expect(
      JSON.parse(
        (fx.db.raw.prepare("SELECT flags_json f FROM offer_request").get() as { f: string }).f,
      ),
    ).toContain("personal_email");
    expect(count("consent_record")).toBe(1);

    // A suppressed address (by keyed hash) is flagged even though it is personal.
    const hash = fx.routing.contacts.emailHash("pat.private@gmail.com");
    fx.routing.suppression.add(
      { userId: "op", actorType: "human", correlationId: null, permissions: [] },
      { scope: "contact", emailHash: hash, reason: "Unsubscribed" },
    );
    advance(120);
    const f2 = await openForm();
    await post(bodyFor(f2, { contact: contact({ email: "pat.private@gmail.com" }) }));
    const last = fx.db.raw
      .prepare("SELECT flags_json f FROM offer_request ORDER BY rowid DESC")
      .get() as { f: string };
    expect(JSON.parse(last.f)).toContain("suppressed");
  });

  it("delivers and records for a suppressed contact or account but never recommends a follow-up (V25)", async () => {
    knownOrg(
      "acc-northvale",
      "Northvale HIE",
      "health_information_exchange",
      "northvale-hie.example",
      NORTHVALE,
    );
    const first = await openForm();
    await post(bodyFor(first));
    const contactId = (fx.db.raw.prepare("SELECT id FROM contact").get() as { id: string }).id;
    fx.routing.suppression.add(
      { userId: "op", actorType: "human", correlationId: null, permissions: [] },
      { scope: "contact", contactId, reason: "Unsubscribed" },
    );
    expect(count("offer_recommendation")).toBe(1);
    advance(120);
    const second = await openForm();
    const res = await post(bodyFor(second));
    expect(res.json().download.delivered).toBe(true);
    expect(count("lead_magnet_download")).toBe(2);
    expect(count("offer_recommendation")).toBe(1);

    // A new contact at a suppressed account gets no follow-up either.
    fx.routing.suppression.add(
      { userId: "op", actorType: "human", correlationId: null, permissions: [] },
      { scope: "account", accountId: "acc-northvale", reason: "Account asked to stop" },
    );
    advance(120);
    const third = await openForm();
    await post(bodyFor(third, { contact: contact({ email: "other@northvale-hie.example" }) }));
    expect(count("lead_magnet_download")).toBe(3);
    expect(count("offer_recommendation")).toBe(1);
  });

  it("records a download for an excluded organisation type with no outreach", async () => {
    const form = await openForm();
    const res = await post(
      bodyFor(form, {
        contact: contact({
          email: "lee@helixbio.example",
          orgName: "Helixbio",
          orgType: "biotech",
        }),
      }),
    );
    expect(res.json().download.delivered).toBe(true);
    expect(
      fx.db.raw.prepare("SELECT outcome, blocked_reasons_json b FROM offer_recommendation").get(),
    ).toMatchObject({ outcome: "no_action", b: '["account_excluded"]' });
  });

  it("flags a different organisation type for an account that is already on file", async () => {
    knownOrg(
      "acc-northvale",
      "Northvale HIE",
      "health_information_exchange",
      "northvale-hie.example",
      NORTHVALE,
    );
    const form = await openForm();
    await post(bodyFor(form, { contact: contact({ orgType: "health_system" }) }));
    expect(
      JSON.parse(
        (fx.db.raw.prepare("SELECT flags_json f FROM offer_request").get() as { f: string }).f,
      ),
    ).toContain("org_type_differs");
    expect(count("account")).toBe(1);
  });

  it("does not create a second request or recommendation for a double submit (V26)", async () => {
    knownOrg(
      "acc-northvale",
      "Northvale HIE",
      "health_information_exchange",
      "northvale-hie.example",
      NORTHVALE,
    );
    const form = await openForm();
    const a = await post(bodyFor(form));
    const b = await post(bodyFor(form));
    expect(b.statusCode).toBe(201);
    expect(b.json().requestId).toBe(a.json().requestId);
    expect(b.json().download.url).toBe(a.json().download.url);
    expect(count("offer_request")).toBe(1);
    expect(count("lead_magnet_download")).toBe(1);
    expect(count("offer_recommendation")).toBe(1);
    expect(count("consent_record")).toBe(1);
  });

  it("serves the file while the link is valid, then 410, and a fresh request is a new download (V27)", async () => {
    const form = await openForm();
    const url = (
      await post(
        bodyFor(form, {
          contact: contact({ email: "dana@newco-hie.example", orgName: "Newco HIE" }),
        }),
      )
    ).json().download.url as string;
    const ok = await fx.app.inject({ method: "GET", url });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("synthetic register");
    expect(ok.headers["content-disposition"]).toContain("attachment");
    expect(ok.headers["cache-control"]).toBe("no-store");
    advance(25 * 3600);
    const gone = await fx.app.inject({ method: "GET", url });
    expect(gone.statusCode).toBe(410);
    expect(gone.json().detail).toMatch(/expired/i);
    const fresh = await openForm();
    const again = await post(
      bodyFor(fresh, {
        contact: contact({ email: "dana@newco-hie.example", orgName: "Newco HIE" }),
      }),
    );
    expect(again.json().download.url).not.toBe(url);
    expect(count("lead_magnet_download")).toBe(2);
    expect(
      (await fx.app.inject({ method: "GET", url: "/api/v1/public/downloads/not-a-token" }))
        .statusCode,
    ).toBe(404);
  });

  it("records a failed delivery in plain words when the register file is missing, and queues no follow-up (V27)", async () => {
    knownOrg(
      "acc-northvale",
      "Northvale HIE",
      "health_information_exchange",
      "northvale-hie.example",
      NORTHVALE,
    );
    fx.files.remove("ccda-to-fhir-mapping-decision-register.pdf");
    const form = await openForm();
    const res = await post(bodyFor(form));
    expect(res.statusCode).toBe(201);
    expect(res.json().download).toMatchObject({ delivered: false, url: null });
    expect(
      fx.db.raw.prepare("SELECT delivered, delivery_failure FROM lead_magnet_download").get(),
    ).toEqual({ delivered: 0, delivery_failure: "file_missing" });
    expect(count("offer_recommendation")).toBe(0);
  });
});

describe("patient-like data", () => {
  it("is refused whole and nothing is stored, logged or sent (V28 for the download form)", async () => {
    approveNotice();
    const form = await openForm();
    for (const field of ["role", "orgName"]) {
      const res = await post(
        bodyFor(form, { contact: contact({ [field]: "Patient SSN 123-45-6789 on file" }) }),
      );
      expect(res.statusCode, field).toBe(422);
    }
    expect(count("offer_request")).toBe(0);
    expect(count("account")).toBe(0);
    expect(count("contact")).toBe(0);
    expect(count("consent_record")).toBe(0);
    expect(count("lead_magnet_download")).toBe(0);
    expect(count("phi_guard_decision")).toBe(2);
    expect(JSON.stringify(fx.db.raw.prepare("SELECT * FROM audit_event").all())).not.toContain(
      "123-45-6789",
    );
  });
});
