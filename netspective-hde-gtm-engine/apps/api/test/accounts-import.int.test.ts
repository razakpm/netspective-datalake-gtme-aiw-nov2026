import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// US1 (tasks T025, T028 to T033): organisation import, duplicates, merge, idempotent re-import.
const FIXTURES = join(import.meta.dirname, "../../../tests/fixtures/synthetic-orgs");
const csv = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

let fx: IdentityFixture;
let operator: { id: string; token: string };
let n = 0;

beforeEach(async () => {
  fx = await buildIdentityFixture();
  operator = await fx.makeUser("operator@example.org", ["gtm_operator"]);
});
afterEach(async () => {
  await fx.app.close();
});

const headers = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  "content-type": "text/csv",
  ...extra,
});
async function importCsv(text: string, opts: { dry?: boolean; token?: string; key?: string } = {}) {
  return fx.app.inject({
    method: "POST",
    url: `/api/v1/accounts/import${opts.dry ? "?dry_run=true" : ""}`,
    headers: headers(opts.token ?? operator.token, {
      "idempotency-key": opts.key ?? `import-key-${++n}-padding`,
    }),
    payload: text,
  });
}
const count = (table: string) =>
  (fx.db.raw.prepare(`SELECT count(*) c FROM ${table}`).get() as { c: number }).c;
const auditActions = () =>
  (
    fx.db.raw.prepare("SELECT action FROM audit_event ORDER BY rowid").all() as { action: string }[]
  ).map((r) => r.action);

describe("organisation import report", () => {
  it("imports the fixture file, rejects the PHI-like row without storing its content, and saves the rest", async () => {
    const res = await importCsv(csv("organisations.csv"));
    expect(res.statusCode).toBe(201);
    const run = res.json();
    expect(run.rowCount).toBe(9);
    const granite = run.rows.find((r: { rowNumber: number }) => r.rowNumber === 9);
    expect(granite.outcome).toBe("rejected");
    expect(granite.reasonCodes[0]).toMatch(/^phi_guard:/);
    expect(run.counts.created).toBe(8);
    expect(count("account")).toBe(8);
    // No content from the rejected row anywhere in the database or the response.
    const dump = JSON.stringify(fx.db.raw.prepare("SELECT * FROM account").all()) + res.body;
    expect(dump).not.toContain("000-12-3456");
    expect(dump).not.toContain("granite-health");
  });

  it("saves valid rows and reports a reason code for every rejected row", async () => {
    const res = await importCsv(csv("organisations-invalid.csv"));
    const rows = res.json().rows as { rowNumber: number; outcome: string; reasonCodes: string[] }[];
    expect(rows.map((r) => [r.outcome, r.reasonCodes[0]])).toEqual([
      ["rejected", "missing_name"],
      ["rejected", "invalid_type"],
      ["rejected", "invalid_domain"],
      ["rejected", "invalid_staffed_beds"],
      ["created", undefined],
    ]);
    expect(count("account")).toBe(1);
  });

  it("rejects a whole file with the wrong columns", async () => {
    const res = await importCsv("name,kind\nA,b\n");
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toContain("missing_required_header");
    expect(count("account")).toBe(0);
  });

  it("a dry run saves nothing but returns the same report", async () => {
    const dry = await importCsv(csv("organisations.csv"), { dry: true });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().counts.created).toBe(8);
    expect(count("account")).toBe(0);
    expect(count("import_run")).toBe(0);
    expect(auditActions().filter((a) => a.startsWith("account"))).toEqual([]);
  });

  it("requires accounts.import and an Idempotency-Key", async () => {
    const reader = await fx.makeUser("reader@example.org", ["read_only_executive"]);
    expect((await importCsv(csv("organisations.csv"), { token: reader.token })).statusCode).toBe(
      403,
    );
    const res = await fx.app.inject({
      method: "POST",
      url: "/api/v1/accounts/import",
      headers: headers(operator.token),
      payload: csv("organisations.csv"),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns the stored run for a replayed key and exposes it by id", async () => {
    const first = await importCsv(csv("organisations.csv"), { key: "same-key-0001" });
    const second = await importCsv(csv("organisations.csv"), { key: "same-key-0001" });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(count("account")).toBe(8);
    const get = await fx.app.inject({
      method: "GET",
      url: `/api/v1/import-runs/${first.json().id}`,
      headers: { authorization: `Bearer ${operator.token}` },
    });
    expect(get.json().rows).toHaveLength(9);
  });
});

describe("idempotent re-import (FR-007, SC-002)", () => {
  it("changes nothing when the same file is imported again", async () => {
    await importCsv(csv("organisations.csv"));
    const before = {
      accounts: fx.db.raw.prepare("SELECT * FROM account ORDER BY id").all(),
      classification: count("account_classification"),
      aliases: count("account_alias"),
      domains: count("account_domain"),
      audit: count("audit_event") - 0,
    };
    const again = await importCsv(csv("organisations.csv"));
    const run = again.json();
    const outcomes = run.rows.map((r: { outcome: string }) => r.outcome);
    expect(outcomes.filter((o: string) => o === "unchanged")).toHaveLength(8);
    expect(run.counts.unchanged).toBe(8);
    expect(fx.db.raw.prepare("SELECT * FROM account ORDER BY id").all()).toEqual(before.accounts);
    expect(count("account_classification")).toBe(before.classification);
    expect(count("account_alias")).toBe(before.aliases);
    expect(count("account_domain")).toBe(before.domains);
    // Only the run's own summary audit event is added: no account events for unchanged rows.
    expect(count("audit_event") - before.audit).toBe(1);
  });

  it("matches a former name after a rename", async () => {
    await importCsv(csv("organisations.csv"));
    const list = await fx.app.inject({
      method: "GET",
      url: "/api/v1/accounts?q=riverbend",
      headers: { authorization: `Bearer ${operator.token}` },
    });
    const id = list.json().items[0].id;
    const patch = await fx.app.inject({
      method: "PATCH",
      url: `/api/v1/accounts/${id}`,
      headers: { authorization: `Bearer ${operator.token}`, "idempotency-key": "rename-key-0001" },
      payload: { name: "Riverbend Regional Medical" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().aliases.map((a: { alias: string }) => a.alias)).toContain(
      "Riverbend Health",
    );
    expect(patch.json().aliases[0].currentUntil).not.toBeNull();
    const again = await importCsv("name,type\nRiverbend Health,health_system\n");
    expect(again.json().rows[0]).toMatchObject({ outcome: "unchanged", entityId: id });
    expect(count("account")).toBe(8);
  });
});

describe("duplicates are flagged, never merged (FR-004, FR-005, SC-003)", () => {
  async function seedAndDuplicates() {
    await importCsv(csv("organisations.csv"));
    return importCsv(csv("organisations-duplicates.csv"));
  }

  it("flags same-domain and similar-name rows and leaves the unrelated row alone", async () => {
    const res = await seedAndDuplicates();
    const rows = res.json().rows as {
      outcome: string;
      reasonCodes: string[];
      matchedId: string | null;
    }[];
    expect(rows.map((r) => r.outcome)).toEqual([
      "flagged",
      "flagged",
      "flagged",
      "created",
      "created",
      "flagged", // the shared-portal domain is not marked shared yet
    ]);
    expect(rows[0]!.reasonCodes).toContain("domain_match");
    expect(rows[1]!.reasonCodes).toContain("name_similarity");
    expect(rows[3]!.reasonCodes).toEqual([]);
    // Every account still exists; none is merged.
    expect(count("account")).toBe(8 + 6);
    expect(
      fx.db.raw.prepare("SELECT count(*) c FROM account WHERE merged_into IS NOT NULL").get(),
    ).toEqual({ c: 0 });
    expect(count("review_item")).toBe(4);
  });

  it("does not propose the pair again on re-import, and a rejected pair stays rejected", async () => {
    await seedAndDuplicates();
    const again = await importCsv(csv("organisations-duplicates.csv"));
    expect(again.json().counts.unchanged).toBe(6);
    expect(count("review_item")).toBe(4);
  });

  it("never flags on a shared domain alone once the domain is marked shared (FR-008)", async () => {
    await importCsv(
      "name,type,geography,domains\nShared Domain Hospital,health_system,Metro area,shared-portal.example\n",
    );
    const first = fx.db.raw.prepare("SELECT id FROM account").get() as { id: string };
    const mark = await fx.app.inject({
      method: "PUT",
      url: `/api/v1/accounts/${first.id}/domains/shared-portal.example/shared`,
      headers: { authorization: `Bearer ${operator.token}` },
      payload: { shared: true },
    });
    expect(mark.statusCode).toBe(204);
    const res = await importCsv(
      "name,type,geography,domains\nShared Domain Exchange,health_information_exchange,Elsewhere,shared-portal.example\n",
    );
    expect(res.json().rows[0].outcome).toBe("created");
    expect(count("review_item")).toBe(0);
  });

  it("merges only on a human decision, keeping names, domains and notes, and needs a choice for conflicts", async () => {
    await seedAndDuplicates();
    const open = fx.db.raw
      .prepare(
        "SELECT id, subject_a, subject_b FROM review_item WHERE reason_codes LIKE '%domain_match%'",
      )
      .get() as { id: string; subject_a: string; subject_b: string };
    const decide = (payload: object, token = operator.token) =>
      fx.app.inject({
        method: "POST",
        url: `/api/v1/review-items/${open.id}/decision`,
        headers: { authorization: `Bearer ${token}`, "idempotency-key": `decide-${++n}-padding` },
        payload,
      });

    expect(
      (await decide({ decision: "merge", reason: "same org", survivorId: "nope" })).statusCode,
    ).toBe(400);
    const reader = await fx.makeUser("reader@example.org", ["read_only_executive"]);
    expect((await decide({ decision: "reject", reason: "no" }, reader.token)).statusCode).toBe(403);

    // The survivor is the existing account (subject_b); the incoming duplicate is subject_a.
    const res = await decide({
      decision: "merge",
      reason: "Same exchange, new name",
      survivorId: open.subject_b,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe("merged");

    const survivor = await fx.app.inject({
      method: "GET",
      url: `/api/v1/accounts/${open.subject_b}`,
      headers: { authorization: `Bearer ${operator.token}` },
    });
    const body = survivor.json();
    expect(body.aliases.map((a: { alias: string }) => a.alias)).toContain(
      "Northvale Regional Exchange",
    );
    expect(body.notes).toContain("Regional exchange with repeated sender onboarding delays.");
    expect(body.notes).toContain("Same domain as an existing account");
    const merged = fx.db.raw
      .prepare("SELECT merged_into FROM account WHERE id = ?")
      .get(open.subject_a) as { merged_into: string };
    expect(merged.merged_into).toBe(open.subject_b);
    expect(auditActions()).toContain("account.merge");
    // A decided item cannot be decided again.
    expect((await decide({ decision: "reject", reason: "again please" })).statusCode).toBe(409);
  });

  it("remembers a rejected pair", async () => {
    await seedAndDuplicates();
    const item = fx.db.raw.prepare("SELECT id FROM review_item LIMIT 1").get() as { id: string };
    const res = await fx.app.inject({
      method: "POST",
      url: `/api/v1/review-items/${item.id}/decision`,
      headers: { authorization: `Bearer ${operator.token}`, "idempotency-key": "reject-key-0001" },
      payload: { decision: "reject", reason: "Different organisations" },
    });
    expect(res.json().state).toBe("rejected");
    expect(auditActions()).toContain("review.reject");
    const list = await fx.app.inject({
      method: "GET",
      url: "/api/v1/review-items?state=rejected",
      headers: { authorization: `Bearer ${operator.token}` },
    });
    expect(list.json().items).toHaveLength(1);
  });

  it("requires a human survivor choice for conflicting types", async () => {
    await importCsv(
      "name,type,geography,domains\nAlpha Clinic,health_system,North,alpha.example\n",
    );
    await importCsv(
      "name,type,geography,domains\nAlpha Clinic Group,other,North,alpha-two.example\n",
    );
    const item = fx.db.raw.prepare("SELECT id, subject_a, subject_b FROM review_item").get() as {
      id: string;
      subject_a: string;
      subject_b: string;
    };
    const decide = (payload: object) =>
      fx.app.inject({
        method: "POST",
        url: `/api/v1/review-items/${item.id}/decision`,
        headers: {
          authorization: `Bearer ${operator.token}`,
          "idempotency-key": `conflict-${++n}-padding`,
        },
        payload,
      });
    const withoutChoice = await decide({
      decision: "merge",
      reason: "Same clinic",
      survivorId: item.subject_b,
    });
    expect(withoutChoice.statusCode).toBe(400);
    expect(
      fx.db.raw.prepare("SELECT count(*) c FROM account WHERE merged_into IS NOT NULL").get(),
    ).toEqual({ c: 0 });
    const ok = await decide({
      decision: "merge",
      reason: "Same clinic",
      survivorId: item.subject_b,
      fieldChoices: { org_type: "a" },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe("account reads and edits", () => {
  it("lists with filters and refuses unauthorised callers; bed count edits are audited without assessing", async () => {
    await importCsv(csv("organisations.csv"));
    const get = (url: string, token = operator.token) =>
      fx.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
    const all = await get("/api/v1/accounts");
    expect(all.json().items).toHaveLength(8);
    expect((await get("/api/v1/accounts?orgType=biotech")).json().items).toHaveLength(1);
    expect((await get("/api/v1/accounts?limit=3")).json().nextCursor).not.toBeNull();
    const nobody = await fx.makeUser("nobody@example.org", ["campaign_approver"]);
    expect((await get("/api/v1/accounts", nobody.token)).statusCode).toBe(403);

    const id = all.json().items[0].id;
    const res = await fx.app.inject({
      method: "PATCH",
      url: `/api/v1/accounts/${id}`,
      headers: { authorization: `Bearer ${operator.token}`, "idempotency-key": "beds-key-0001" },
      payload: { staffedBedCount: 420 },
    });
    expect(res.json().staffedBedCount).toBe(420);
    expect(res.json().classificationHistory).toHaveLength(2);
    expect(auditActions()).toContain("account.update");
  });

  it("emits account.created with identifiers only", async () => {
    await importCsv(csv("organisations.csv"));
    const events = fx.db.raw
      .prepare("SELECT payload FROM outbox_event WHERE type = 'account.created'")
      .all() as { payload: string }[];
    expect(events).toHaveLength(8);
    for (const e of events) {
      expect(Object.keys(JSON.parse(e.payload)).sort()).toEqual([
        "account_id",
        "org_type",
        "source",
      ]);
    }
  });
});
