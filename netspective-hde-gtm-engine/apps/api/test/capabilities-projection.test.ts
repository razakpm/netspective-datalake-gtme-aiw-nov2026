import { describe, expect, it } from "vitest";
import { toPublicCapability } from "../src/modules/capabilities/index.js";
import { buildCatalogueHarness, FULL_CAPABILITY } from "../test-support/catalogue-harness.js";

// Task T042: internal delivery examples never reach a public view or a list (spec FR-022, SC-007).
// A small deterministic generator stands in for a property test.
function* generated(count: number) {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (let i = 0; i < count; i++) {
    yield {
      slot: 1 + (next() % 19),
      examples: Array.from(
        { length: 1 + (next() % 3) },
        (_, k) => `INTERNAL-EXAMPLE-${i}-${k}-${next()}`,
      ),
    };
  }
}

describe("public projection", () => {
  it("builds a view from an explicit whitelist, so an extra example field cannot leak", () => {
    const leaky = {
      ...FULL_CAPABILITY,
      slot: 3,
      deliveryExamples: ["SECRET-EXAMPLE"],
      examples: ["SECRET-EXAMPLE"],
    };
    const view = toPublicCapability(leaky as never);
    expect(JSON.stringify(view)).not.toContain("SECRET-EXAMPLE");
    expect(Object.keys(view).sort()).toEqual(
      [
        "buyerProblems",
        "description",
        "inputTypes",
        "limitations",
        "name",
        "outputTypes",
        "slot",
      ].sort(),
    );
  });

  it("never contains example text for any generated capability, in the public view, the list or a plain read", () => {
    const h = buildCatalogueHarness();
    const lead = h.actor("lead");
    const seen = new Set<number>();
    const markers: string[] = [];
    for (const g of generated(25)) {
      if (seen.has(g.slot)) continue;
      seen.add(g.slot);
      const id = `capability-${String(g.slot).padStart(2, "0")}`;
      for (const text of g.examples) {
        h.capabilities.addExample(lead, id, { text });
        markers.push(text);
      }
    }
    h.makeCapabilityPublic("capability-01");
    expect(markers.length).toBeGreaterThan(10);
    const outputs = [
      JSON.stringify(h.capabilities.publicView()),
      JSON.stringify(h.capabilities.list(h.actor("analyst"))),
      JSON.stringify(h.capabilities.get(h.actor("analyst"), "capability-01")),
      JSON.stringify(h.capabilities.get(h.actor("executive"), "capability-01")),
    ];
    for (const out of outputs) for (const m of markers) expect(out).not.toContain(m);
  });

  it("returns examples only to a holder of capabilities.examples.read", () => {
    const h = buildCatalogueHarness();
    h.capabilities.addExample(h.actor("lead"), "capability-02", {
      text: "Internal delivery note about a mapping effort",
    });
    const asAnalyst = h.capabilities.get(h.actor("analyst"), "capability-02");
    expect("deliveryExamples" in asAnalyst).toBe(false);
    const asLead = h.capabilities.get(h.actor("lead"), "capability-02");
    expect(asLead.deliveryExamples?.map((e) => e.text)).toEqual([
      "Internal delivery note about a mapping effort",
    ]);
  });

  it("includes only approved capabilities whose public claim is still usable", () => {
    const h = buildCatalogueHarness();
    h.makeCapabilityPublic("capability-01");
    h.makeCapabilityPublic("capability-02");
    expect(h.capabilities.publicView().map((c) => c.slot)).toEqual([1, 2]);
    h.advanceDays(400);
    expect(h.capabilities.publicView()).toEqual([]);
  });
});
