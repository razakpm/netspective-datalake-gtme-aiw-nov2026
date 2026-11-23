import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildIdentityFixture } from "../../../api/test-support/identity-fixture.js";

// The API for the browser test (feature 006, task T071): the same in-memory API the integration tests use,
// with the fake providers, a synthetic register file, one approved notice version and the synthetic
// organisation northvale-hie with its recorded evidence. It listens on a port and writes an operator token to
// e2e/.runtime so the test can read the follow-up recommendation the way an operator's screen would.
// Synthetic data only.

const PORT = Number(process.env["E2E_API_PORT"] ?? 3999);

const fx = await buildIdentityFixture();
// Real time, so the form's minimum time to submit and the link's expiry behave as they do in use.
Object.defineProperty(fx.clock, "now", { get: () => new Date(), configurable: true });

const approver = (id: string) => ({
  userId: id,
  actorType: "human" as const,
  correlationId: null,
  permissions: ["notices.manage" as const, "notices.approve" as const],
});
const notice = fx.engagement.notices.create(approver("e2e-author"), {
  noticeText:
    "We use your details to send the register and, only if you agree, to contact you about it.",
  consentText: "I agree to be contacted about this topic.",
});
fx.engagement.notices.approve(approver("e2e-approver"), notice.id);

const at = new Date().toISOString();
fx.db.raw
  .prepare(
    "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('acc-northvale','Northvale Health Information Exchange','northvale health information exchange',?,?)",
  )
  .run(at, at);
fx.db.raw
  .prepare(
    "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES ('cl-n','acc-northvale','health_information_exchange',?)",
  )
  .run(at);
fx.db.raw
  .prepare(
    "INSERT INTO account_domain (id, account_id, domain, created_at) VALUES ('d-n','acc-northvale','northvale-hie.example',?)",
  )
  .run(at);
fx.db.raw
  .prepare(
    "INSERT INTO evidence_reference (id, account_id, topic, what, where_ref, observed_at, recorded_at, status) VALUES ('ev-n','acc-northvale','sender_onboarding_friction','Repeated sender onboarding delays.','https://evidence.example/northvale',?,?,'observed')",
  )
  .run(at, at);

const operator = await fx.makeUser("operator@example.org", ["gtm_operator"]);
const dir = join(import.meta.dirname, "..", ".runtime");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "operator-token.txt"), operator.token);

await fx.app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`e2e API listening on ${PORT}`);
