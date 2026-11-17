import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// SC-005, FR-021, Scenario D (task T062): every prohibited sample is blocked at the API boundary,
// stored nowhere in clear, absent from logs, and leaves a decision row, an audit event and one alert.
interface RawSample {
  id: string;
  kind: string;
  rules: string[];
  content: unknown;
}
interface Sample extends RawSample {
  /** The sample as text: strings as is, structured samples JSON-encoded. */
  text: string;
}
const raw = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "tests",
      "fixtures",
      "phi-samples",
      "prohibited.json",
    ),
    "utf8",
  ),
) as RawSample[];
const samples: Sample[] = raw.map((s) => ({
  ...s,
  text: typeof s.content === "string" ? s.content : JSON.stringify(s.content),
}));

let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});

function dumpDatabase(): string {
  const tables = fx.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[];
  return tables
    .map((t) =>
      JSON.stringify(fx.db.raw.prepare(`SELECT * FROM "${t.name}"`).all(), (_k, v: unknown) =>
        v instanceof Uint8Array ? Buffer.from(v).toString("latin1") : v,
      ),
    )
    .join("\n");
}

describe.each(samples)("prohibited sample: $id", (sample) => {
  const where = [
    {
      part: "body",
      send: () => ({
        method: "POST" as const,
        url: "/api/v1/users",
        payload: { email: "a@example.org", displayName: sample.content },
      }),
    },
    {
      part: "query",
      send: () => ({
        method: "GET" as const,
        url: `/api/v1/users?cursor=${encodeURIComponent(sample.text)}`,
      }),
    },
    {
      part: "header",
      send: () => ({
        method: "GET" as const,
        url: "/api/v1/users",
        headers: { "x-note": sample.text.replace(/[^\x20-\x7e]/g, " ") },
      }),
    },
    {
      part: "filename field",
      send: () => ({
        method: "POST" as const,
        url: "/api/v1/users",
        payload: { email: "a@example.org", filename: `${sample.text}.csv` },
      }),
    },
  ];

  // Multi-line tabular samples cannot travel in a header line.
  const applicable = where.filter(
    (w) =>
      !(w.part === "header" && sample.kind.startsWith("tabular")) &&
      // A suffix breaks JSON, so structured samples are not realistic file names.
      !(w.part === "filename field" && /^\s*[[{]/.test(sample.text)),
  );
  it.each(applicable)("is blocked in the $part with a content-free 422", async ({ send }) => {
    const res = await fx.app.inject(send());
    expect(res.statusCode).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const problem = res.json() as { ruleIds: string[]; detail: string };
    expect(problem.ruleIds).toEqual(expect.arrayContaining(sample.rules));
    expect(res.body).not.toContain(sample.text);
  });

  it("leaves a decision row and an audit event, stores nothing in clear and logs nothing", async () => {
    await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { email: "a@example.org", displayName: sample.content },
    });

    const decisions = fx.db.raw
      .prepare("SELECT decision, rule_ids, guard_version FROM phi_guard_decision")
      .all() as { decision: string; rule_ids: string }[];
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decision).toBe("reject");
    expect(JSON.parse(decisions[0]!.rule_ids)).toEqual(expect.arrayContaining(sample.rules));

    const audit = fx.db.raw.prepare("SELECT action, outcome FROM audit_event").all();
    expect(audit).toEqual([{ action: "phi.blocked", outcome: "failed" }]);

    expect(dumpDatabase()).not.toContain(sample.text);
    expect(fx.logs.join("")).not.toContain(sample.text);
  });
});

describe("operator notification (FR-019)", () => {
  it("raises one content-free alert per entry point per minute", async () => {
    const send = () =>
      fx.app.inject({
        method: "POST",
        url: "/api/v1/users",
        payload: { note: samples[0]!.text },
      });
    await send();
    await send();
    await send();
    const alerts = fx.db.raw
      .prepare("SELECT type, payload FROM outbox_event WHERE type = 'operator.alert.phi'")
      .all() as { payload: string }[];
    expect(alerts).toHaveLength(1);
    const payload = JSON.parse(alerts[0]!.payload) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "action",
      "correlationId",
      "entryPoint",
      "occurredAt",
      "recipients",
      "ruleIds",
    ]);
    expect(alerts[0]!.payload).not.toContain(samples[0]!.text);
    expect(fx.notifier.suppressed).toBe(2);
    // every block is still audited even when the alert is suppressed
    expect(
      fx.db.raw.prepare("SELECT count(*) c FROM audit_event WHERE action = 'phi.blocked'").get(),
    ).toEqual({ c: 3 });
  });
});
