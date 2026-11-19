import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { describe, expect, it } from "vitest";
import { buildServices } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";
import { createLlmProvider, createSourceProvider } from "../src/research-stack.js";

// Task T071: the composition root builds the research stack from configuration.
const base = { NODE_ENV: "test", DATABASE_URL: "postgres://gtm:x@localhost:5432/gtm" };
const db = () => {
  const d = new SqliteDatabase();
  migrate(d);
  d.transaction((tx) => seedReference(tx));
  return d;
};

describe("research composition", () => {
  it("defaults to the fake model and manual capture, with no network", () => {
    const config = loadConfig(base);
    expect(createLlmProvider(config).name).toBe("fake");
    expect(createSourceProvider(config).name).toBe("manual-capture");
  });
  it("chooses the anthropic adapter only with a key, and web fetch only when an administrator switched it on", () => {
    const anthropic = loadConfig({
      ...base,
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "key-for-tests-0000",
    });
    expect(createLlmProvider(anthropic).name).toBe("anthropic");
    expect(
      createSourceProvider(loadConfig({ ...base, RESEARCH_WEB_FETCH_ENABLED: "true" })).name,
    ).toBe("web-fetch");
    expect(() => loadConfig({ ...base, LLM_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: "production",
        OIDC_ISSUER_URL: "https://login.example.org",
        OIDC_AUDIENCE: "a",
        QUARANTINE_ENCRYPTION_KEY: "x".repeat(32),
        SUPPRESSION_HASH_KEY: "y".repeat(32),
        DATABASE_URL: "postgres://gtm:x@db.example.org:5432/gtm?sslmode=verify-full",
      }),
    ).toThrow(/LLM_PROVIDER/);
  });
  it("builds services that share one database and carry the configured limits", () => {
    const config = loadConfig({
      ...base,
      RESEARCH_MAX_SOURCES: "7",
      RESEARCH_RUN_COST_CAP: "1.25",
    });
    const services = buildServices(config, db());
    expect(services.research.settings).toMatchObject({
      maxSources: 7,
      runCapMicros: 1_250_000,
      accountMonthlyCapMicros: 20_000_000,
    });
    expect(services.research.settings.hypothesisStaleDays).toBe(90);
  });
  it("runs a manual-capture run end to end on the development fake, inventing nothing", async () => {
    const config = loadConfig(base);
    const d = db();
    const services = buildServices(config, d);
    const now = new Date().toISOString();
    d.raw
      .prepare(
        "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a1','Acme','acme',?,?)",
      )
      .run(now, now);
    services.research.rules.create(
      { userId: "admin", actorType: "human", correlationId: null },
      { kind: "analyst_capture", matchType: "host", pattern: "pages.example" },
    );
    const run = services.research.research.startRun(
      { userId: "analyst", actorType: "human", correlationId: null },
      "a1",
      {
        sources: [
          {
            address: "https://pages.example/acme",
            capturedText: "Acme is a regional organisation with several teams.",
          },
        ],
      },
    );
    await services.research.runner.execute(run.id);
    const done = services.research.research.get(run.id);
    expect(done.state).toBe("completed");
    const summary = services.research.research.accountSummary("a1");
    expect(summary.facts).toEqual([]);
    expect(summary.unknowns).toHaveLength(5);
    expect((d.raw.prepare("SELECT count(*) c FROM signal").get() as { c: number }).c).toBe(0);
  });
});
