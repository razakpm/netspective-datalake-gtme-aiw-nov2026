import { GUARD_VERSION } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CANARY_PHI } from "../../../packages/domain/test-support/canaries.js";
import { QuarantineService } from "../src/modules/audit/quarantine-service.js";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Interim SQLite run of T063 (ADR-015). Route-level permission checks are in quarantine.contract.test.ts.
const KEY = "quarantine-test-key-0123456789abcdef-not-real";
let fx: IdentityFixture;
let svc: QuarantineService;
let reviewer: { id: string };
let clock = new Date("2026-11-13T00:00:00.000Z");

beforeEach(async () => {
  clock = new Date("2026-11-13T00:00:00.000Z");
  fx = await buildIdentityFixture();
  svc = new QuarantineService(fx.db, KEY, 30, () => clock);
  reviewer = await fx.makeUser("reviewer@example.org");
});
afterEach(async () => {
  await fx.app.close();
});

const hold = () =>
  fx.db.transaction((tx) =>
    svc.hold(tx, {
      entryPoint: "api_body",
      content: CANARY_PHI,
      ruleIds: ["PHI.MRN_WITH_NAME"],
      guardVersion: GUARD_VERSION,
    }),
  );
const actor = (over = {}) => ({
  userId: reviewer.id,
  actorType: "human" as const,
  correlationId: "corr-12345",
  ...over,
});
const auditActions = () =>
  (
    fx.db.raw.prepare("SELECT action FROM audit_event ORDER BY rowid").all() as { action: string }[]
  ).map((r) => r.action);

describe("quarantine storage", () => {
  it("encrypts content at rest and keeps only metadata readable", () => {
    const id = hold();
    const raw = fx.db.raw.prepare("SELECT * FROM quarantine_item WHERE id = ?").get(id) as Record<
      string,
      unknown
    >;
    const dump =
      Buffer.from(raw["content_encrypted"] as Uint8Array).toString("latin1") +
      JSON.stringify({ ...raw, content_encrypted: null });
    expect(dump).not.toContain("Canaryfield");
    expect(dump).not.toContain("00987654");
    expect(JSON.stringify(svc.getMeta(id))).not.toContain("Canaryfield");
    expect(svc.getMeta(id)).toMatchObject({
      status: "held",
      ruleIds: ["PHI.MRN_WITH_NAME"],
      entryPoint: "api_body",
    });
  });

  it("decrypts only with the right key", () => {
    const id = hold();
    const other = new QuarantineService(
      fx.db,
      "a-completely-different-key-0123456789abcdef",
      30,
      () => clock,
    );
    expect(() =>
      fx.db.transaction((tx) =>
        other.view(tx, { userId: reviewer.id, correlationId: null }, id, "review"),
      ),
    ).toThrow();
    expect(
      fx.db.transaction((tx) =>
        svc.view(tx, { userId: reviewer.id, correlationId: null }, id, "review"),
      ),
    ).toBe(CANARY_PHI);
  });

  it("rejects short keys", () => {
    expect(() => new QuarantineService(fx.db, "short")).toThrow(/32/);
  });

  it("logs and audits every read", () => {
    const id = hold();
    fx.db.transaction((tx) =>
      svc.view(
        tx,
        { userId: reviewer.id, correlationId: "corr-12345" },
        id,
        "false positive check",
      ),
    );
    expect(fx.db.raw.prepare("SELECT actor_id, purpose FROM quarantine_access").all()).toEqual([
      { actor_id: reviewer.id, purpose: "false positive check" },
    ]);
    expect(auditActions()).toEqual(["quarantine.viewed"]);
    const audit = JSON.stringify(fx.db.raw.prepare("SELECT * FROM audit_event").all());
    expect(audit).not.toContain("Canaryfield");
  });
});

describe("decisions", () => {
  it("requires a human actor and a reason", () => {
    const id = hold();
    for (const actorType of ["ai", "system"] as const) {
      expect(() =>
        fx.db.transaction((tx) => svc.release(tx, actor({ actorType }), id, "looks fine")),
      ).toThrow(/human/);
    }
    expect(() => fx.db.transaction((tx) => svc.discard(tx, actor(), id, " "))).toThrow(/reason/i);
    expect(svc.getMeta(id).status).toBe("held");
  });

  it("audits release and discard, and discard removes the content", () => {
    const a = hold();
    const b = hold();
    fx.db.transaction((tx) => svc.release(tx, actor(), a, "benign near-miss"));
    fx.db.transaction((tx) => svc.discard(tx, actor(), b, "real PHI, destroy"));
    expect(auditActions()).toEqual(["quarantine.released", "quarantine.discarded"]);
    expect(svc.getMeta(b)).toMatchObject({
      status: "discarded",
      contentPurged: true,
      decidedBy: reviewer.id,
    });
    expect(svc.getMeta(a).decisionReason).toBe("benign near-miss");
  });

  it("refuses a second decision", () => {
    const id = hold();
    fx.db.transaction((tx) => svc.discard(tx, actor(), id, "destroy it"));
    expect(() =>
      fx.db.transaction((tx) => svc.release(tx, actor(), id, "changed my mind")),
    ).toThrow(/already/);
  });
});

describe("retention", () => {
  it("purges content after the holding period, keeping metadata", () => {
    const id = hold();
    clock = new Date("2026-12-01T00:00:00.000Z"); // inside 30 days
    expect(fx.db.transaction((tx) => svc.purgeExpired(tx))).toBe(0);
    clock = new Date("2026-12-14T00:00:00.000Z"); // past 30 days
    expect(fx.db.transaction((tx) => svc.purgeExpired(tx))).toBe(1);
    expect(svc.getMeta(id)).toMatchObject({ status: "held", contentPurged: true });
    expect(() =>
      fx.db.transaction((tx) =>
        svc.view(tx, { userId: reviewer.id, correlationId: null }, id, "x"),
      ),
    ).toThrow(/purged/);
    expect(auditActions()).toContain("quarantine.purged");
  });
});
