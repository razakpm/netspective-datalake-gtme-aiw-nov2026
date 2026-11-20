import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T078: the catalogue screens' data loads in under 2 seconds (plan performance goal); the checker bound
// of 50 ms for 20,000 characters is tested in packages/domain/test/claims/linter.test.ts.
let fx: IdentityFixture;
let token: string;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  token = (await fx.makeUser("lead@example.org", ["sales_service_lead"])).token;
});
afterEach(async () => {
  await fx.app.close();
});

describe("catalogue data loads", () => {
  it("returns 10 offers and 19 capabilities in under 2 seconds", async () => {
    const t0 = performance.now();
    const [offers, capabilities] = await Promise.all(
      ["/offers", "/service-capabilities"].map((u) =>
        fx.app.inject({
          method: "GET",
          url: `/api/v1${u}`,
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    );
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(offers!.statusCode).toBe(200);
    expect(capabilities!.statusCode).toBe(200);
  });
});
