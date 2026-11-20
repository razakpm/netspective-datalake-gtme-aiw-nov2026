import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T077 (quickstart V8, V20, V23) through the HTTP routes against the seeded database.
let fx: IdentityFixture;
let token: string;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  token = (await fx.makeUser("reader@example.org", ["sales_service_lead"])).token;
});
afterEach(async () => {
  await fx.app.close();
});
const get = async (url: string) =>
  (
    await fx.app.inject({
      method: "GET",
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
    })
  ).json();

describe("the seeded catalogue over HTTP", () => {
  it("lists ten offers: 1, 5 and 6 approved with the baseline notice, the rest draft (V8)", async () => {
    const { items } = (await get("/offers")) as {
      items: { number: number; status: string; baselineIncomplete: boolean }[];
    };
    expect(items).toHaveLength(10);
    for (const o of items) {
      expect(o.status).toBe([1, 5, 6].includes(o.number) ? "approved" : "draft");
      expect(o.baselineIncomplete).toBe([1, 5, 6].includes(o.number));
    }
  });

  it("lists three paid engagement types with no price field and Resilience Review inactive (V20)", async () => {
    const body = await get("/paid-engagement-types");
    expect(body.items.map((t: { key: string }) => t.key)).toEqual([
      "input_audit",
      "resilience_review",
      "sender_readiness_sprint",
    ]);
    expect(body.items.find((t: { key: string }) => t.key === "resilience_review").status).toBe(
      "inactive",
    );
    expect(JSON.stringify(body)).not.toMatch(/"(price|fee|rate|currency|cost|amount)"/);
  });

  it("lists 19 capability slots with placeholders marked and no delivery example (V23)", async () => {
    const body = await get("/service-capabilities");
    expect(body.items).toHaveLength(19);
    expect(
      body.items.every(
        (c: { placeholderAttributes: string[] }) => c.placeholderAttributes.length === 8,
      ),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain("deliveryExamples");
  });
});
