import { describe, expect, it } from "vitest";
import { buildResearchHarness } from "../test-support/research-harness.js";
import { ResearchSourceRules } from "../src/modules/research/sources.js";

// Task T026: the approved source list. Rules are admin-managed, validated, audited and never deleted.
const setup = () => {
  const h = buildResearchHarness();
  h.db.raw.exec("DELETE FROM research_source_rule WHERE 1 = 0");
  return { h, rules: new ResearchSourceRules(h.db, false) };
};

describe("research source rules", () => {
  it("creates a rule with the signal source kind following its kind, and lists it", () => {
    const { h, rules } = setup();
    const created = rules.create(h.actor({ userId: "admin-1" }), {
      kind: "public_procurement",
      matchType: "host_suffix",
      pattern: "Portal.Example.GOV",
    });
    expect(created).toMatchObject({
      kind: "public_procurement",
      matchType: "host_suffix",
      pattern: "portal.example.gov",
      status: "enabled",
      statusLabel: "hypothesis",
    });
    expect(rules.list().items.some((r) => r.pattern === "portal.example.gov")).toBe(true);
    expect(rules.list().webFetchEnabled).toBe(false);
    const row = h.db.raw
      .prepare("SELECT signal_source_kind FROM research_source_rule WHERE id = ?")
      .get(created.id) as { signal_source_kind: string };
    expect(row.signal_source_kind).toBe("official_publication");
    expect(h.count("audit_event", "action = 'research.source.rule.create'")).toBe(1);
  });
  it("rejects bad patterns, duplicates and unknown kinds", () => {
    const { h, rules } = setup();
    const create =
      (pattern: string, kind: string = "public_org_site") =>
      () =>
        rules.create(h.actor(), { kind: kind as never, matchType: "host", pattern });
    for (const bad of [
      "ab",
      "has space.example",
      ".leading.example",
      "double..dot.example",
      "https://x.example",
      "x.example/path",
    ])
      expect(create(bad), bad).toThrow(/host name/);
    expect(create("x.example", "social_media")).toThrow(/Unknown source kind/);
    rules.create(h.actor(), {
      kind: "public_org_site",
      matchType: "host",
      pattern: "unique.example",
    });
    expect(create("unique.example")).toThrow(/already exists/);
  });
  it("disables and re-enables a rule, audited, and never deletes", () => {
    const { h, rules } = setup();
    const r = rules.create(h.actor(), {
      kind: "public_org_site",
      matchType: "host",
      pattern: "toggle.example",
    });
    expect(rules.setStatus(h.actor(), r.id, "disabled").status).toBe("disabled");
    expect(rules.setStatus(h.actor(), r.id, "enabled").status).toBe("enabled");
    expect(() => rules.setStatus(h.actor(), "nope", "disabled")).toThrow(/No such source rule/);
    expect(() =>
      h.db.raw.prepare("DELETE FROM research_source_rule WHERE id = ?").run(r.id),
    ).toThrow();
    expect(h.count("audit_event", "action = 'research.source.rule.update'")).toBe(2);
  });
  it("makes a disabled rule stop approving its source in the next run", async () => {
    const h = buildResearchHarness({ scenario: "northvale" });
    h.db.raw
      .prepare(
        "UPDATE research_source_rule SET status = 'disabled' WHERE pattern = 'northvale-hie.example'",
      )
      .run();
    const run = await h.runFor("acc-northvale", ["https://news.northvale-hie.example/senders"]);
    const outcome = h.db.raw
      .prepare("SELECT outcome FROM research_source_fetch WHERE run_id = ?")
      .get(run.id) as { outcome: string };
    expect(outcome.outcome).toBe("refused_unapproved");
  });
});
