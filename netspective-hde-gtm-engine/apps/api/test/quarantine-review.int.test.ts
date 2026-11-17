import { GUARD_VERSION, guardValue } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QuarantineService } from "../src/modules/audit/quarantine-service.js";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// False-positive handling (task T064, US3 scenario 5).
const KEY = "quarantine-test-key-0123456789abcdef-not-real";
const near = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "..", "..", "tests", "fixtures", "phi-samples", "benign.json"),
    "utf8",
  ),
) as { id: string; content: string }[];

let fx: IdentityFixture;
let svc: QuarantineService;
let reviewerId: string;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  svc = new QuarantineService(fx.db, KEY);
  reviewerId = (await fx.makeUser("reviewer@example.org")).id;
});
afterEach(async () => {
  await fx.app.close();
});
const human = () => ({ userId: reviewerId, actorType: "human" as const, correlationId: null });

describe("releasing a false positive", () => {
  it("shows the reason, releases once and records who decided", () => {
    const sample = near[0]!;
    const id = fx.db.transaction((tx) =>
      svc.hold(tx, {
        entryPoint: "api_body",
        content: sample.content,
        ruleIds: ["PHI.TABULAR_ROWS"],
        guardVersion: GUARD_VERSION,
      }),
    );
    // The reviewer sees why it was held, from metadata, before viewing any content.
    expect(svc.getMeta(id).ruleIds).toEqual(["PHI.TABULAR_ROWS"]);

    fx.db.transaction((tx) => svc.release(tx, human(), id, "benign near-miss: field names only"));
    expect(svc.getMeta(id)).toMatchObject({ status: "released", decidedBy: reviewerId });

    const released = fx.db.transaction((tx) => svc.consumeRelease(tx, id));
    expect(released.content).toBe(sample.content);
    // Not re-blocked by the rule version that held it: the pipeline is told which version released it.
    expect(released.releasedFromGuardVersion).toBe(GUARD_VERSION);

    // ... and it re-enters exactly once.
    expect(() => fx.db.transaction((tx) => svc.consumeRelease(tx, id))).toThrow(/already used/);
  });

  it("does not release content that was discarded or never released", () => {
    const id = fx.db.transaction((tx) =>
      svc.hold(tx, {
        entryPoint: "api_body",
        content: "x",
        ruleIds: ["PHI.SSN"],
        guardVersion: GUARD_VERSION,
      }),
    );
    expect(() => fx.db.transaction((tx) => svc.consumeRelease(tx, id))).toThrow(/not available/);
  });

  it("keeps benign near-miss samples out of the guard in the first place", () => {
    for (const sample of near) expect(guardValue(sample.content).decision, sample.id).toBe("allow");
  });
});
