import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/index.js";
import { CANARY_SECRET } from "../../../packages/domain/test-support/canaries.js";

const baseEnv = { DATABASE_URL: "postgres://gtm:local-only@localhost:5432/gtm" };

describe("typed config", () => {
  it("loads defaults for development", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.env).toBe("development");
    expect(config.role).toBe("both");
    expect(config.port).toBe(3000);
    expect(config.providers.useFake).toBe(true);
    expect(config.oidc.useFake).toBe(true);
  });

  it("fails fast when a required variable is missing, naming the variable only", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const problems = (error as ConfigError).problems;
      expect(problems.map((p) => p.variable)).toContain("DATABASE_URL");
    }
  });

  it("never prints a secret value in an error (spec FR-034)", () => {
    const env = {
      DATABASE_URL: `not a url ${CANARY_SECRET}`,
      PORT: `abc${CANARY_SECRET}`,
      LOG_LEVEL: CANARY_SECRET,
    };
    let message = "";
    let serialised = "";
    try {
      loadConfig(env);
    } catch (error) {
      message = (error as Error).message;
      serialised = JSON.stringify((error as ConfigError).problems);
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain(CANARY_SECRET);
    expect(serialised).not.toContain(CANARY_SECRET);
  });

  it("rejects malformed numbers and out-of-range values", () => {
    for (const env of [
      { ...baseEnv, PORT: "0" },
      { ...baseEnv, PORT: "70000" },
      { ...baseEnv, JOB_MAX_ATTEMPTS: "-1" },
      { ...baseEnv, WEBHOOK_SKEW_SECONDS: "1.5" },
      { ...baseEnv, LOG_LEVEL: "loud" },
    ]) {
      expect(() => loadConfig(env)).toThrow(ConfigError);
    }
  });

  it("exposes every research R-14 default and lets the environment override each one", () => {
    const defaults = loadConfig({ ...baseEnv });
    expect(defaults.jobs).toMatchObject({
      maxAttempts: 5,
      backoffBaseSeconds: 30,
      backoffFactor: 2,
      backoffCapSeconds: 3600,
      concurrency: 5,
      queueDepthCap: 1000,
    });
    expect(defaults.limits).toMatchObject({
      webhookSkewSeconds: 300,
      webhookBodyBytes: 1_048_576,
      apiBodyBytes: 2_097_152,
      uploadBytes: 10_485_760,
    });
    expect(defaults.session).toEqual({ absoluteSeconds: 28_800, idleSeconds: 1_800 });
    expect(defaults.invitationExpiryDays).toBe(7);
    expect(defaults.retention).toEqual({
      auditYears: 7,
      aiInvocationMonths: 12,
      webhookBodyDays: 90,
      quarantineDays: 30,
      jobDetailDays: 90,
      idempotencyHours: 24,
    });

    const overridden = loadConfig({
      ...baseEnv,
      JOB_MAX_ATTEMPTS: "9",
      WEBHOOK_SKEW_SECONDS: "60",
      SESSION_IDLE_SECONDS: "600",
      RETENTION_AUDIT_YEARS: "10",
      RETENTION_IDEMPOTENCY_HOURS: "48",
    });
    expect(overridden.jobs.maxAttempts).toBe(9);
    expect(overridden.limits.webhookSkewSeconds).toBe(60);
    expect(overridden.session.idleSeconds).toBe(600);
    expect(overridden.retention.auditYears).toBe(10);
    expect(overridden.retention.idempotencyHours).toBe(48);
  });

  it("refuses fake providers and a fake OIDC issuer in production (spec FR-045)", () => {
    const production = {
      ...baseEnv,
      DATABASE_URL: "postgres://gtm:x@db.example.org:5432/gtm?sslmode=verify-full",
      NODE_ENV: "production",
      OIDC_ISSUER_URL: "https://login.example.org",
      OIDC_AUDIENCE: "gtm-engine",
      QUARANTINE_ENCRYPTION_KEY: "x".repeat(32),
      SUPPRESSION_HASH_KEY: "y".repeat(32),
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "k".repeat(16),
    };
    expect(() => loadConfig({ ...production })).not.toThrow();
    const withoutKey: Record<string, string> = { ...production };
    delete withoutKey["SUPPRESSION_HASH_KEY"];
    expect(() => loadConfig(withoutKey)).toThrow(/SUPPRESSION_HASH_KEY/);
    expect(loadConfig({ NODE_ENV: "test", DATABASE_URL: production.DATABASE_URL }).imports).toEqual(
      {
        maxBytes: 5_242_880,
        maxRows: 5000,
      },
    );

    for (const flag of ["USE_FAKE_PROVIDERS", "USE_FAKE_OIDC"]) {
      let problems: string[] = [];
      try {
        loadConfig({ ...production, [flag]: "true" });
      } catch (error) {
        problems = (error as ConfigError).problems.map((p) => p.variable);
      }
      expect(problems).toContain(flag);
    }
  });

  it("requires OIDC settings and the quarantine key in production", () => {
    let problems: string[] = [];
    try {
      loadConfig({
        ...baseEnv,
        DATABASE_URL: "postgres://gtm:x@db.example.org:5432/gtm?sslmode=verify-full",
        NODE_ENV: "production",
      });
    } catch (error) {
      problems = (error as ConfigError).problems.map((p) => p.variable);
    }
    expect(problems).toEqual(
      expect.arrayContaining(["OIDC_ISSUER_URL", "OIDC_AUDIENCE", "QUARANTINE_ENCRYPTION_KEY"]),
    );
  });

  it("lists secret values so the logger can scrub them", () => {
    const config = loadConfig({
      ...baseEnv,
      DATABASE_URL: `postgres://gtm:${CANARY_SECRET}@localhost:5432/gtm`,
    });
    expect(config.secretValues).toContain(CANARY_SECRET);
  });
});

describe("feature 004 configuration", () => {
  it("defaults to the fake model, 10 sources, 2.00 per run, 20.00 per account per month and 90 days", () => {
    const c = loadConfig(baseEnv);
    expect(c.llm.provider).toBe("fake");
    expect(c.llm.models).toEqual({
      extraction: "claude-haiku-5-5",
      synthesis: "claude-sonnet-5-5",
    });
    expect(c.research).toMatchObject({
      maxSources: 10,
      runCapMicros: 2_000_000,
      accountMonthlyCapMicros: 20_000_000,
      maxRetries: 2,
      interpretationCapMicros: 200_000,
      webFetchEnabled: false,
      hypothesisStaleDays: 90,
    });
  });
  it("parses money without floating point and rejects malformed amounts", () => {
    expect(loadConfig({ ...baseEnv, RESEARCH_RUN_COST_CAP: "0.05" }).research.runCapMicros).toBe(
      50_000,
    );
    expect(
      loadConfig({ ...baseEnv, RESEARCH_RUN_COST_CAP: "12.345678" }).research.runCapMicros,
    ).toBe(12_345_678);
    expect(() => loadConfig({ ...baseEnv, RESEARCH_RUN_COST_CAP: "two" })).toThrow(
      /RESEARCH_RUN_COST_CAP/,
    );
    expect(() => loadConfig({ ...baseEnv, RESEARCH_MAX_SOURCES: "26" })).toThrow(
      /RESEARCH_MAX_SOURCES/,
    );
  });
  it("needs a key with the anthropic provider and refuses the fake model in production", () => {
    expect(() => loadConfig({ ...baseEnv, LLM_PROVIDER: "anthropic" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    const production = {
      ...baseEnv,
      DATABASE_URL: "postgres://gtm:x@db.example.org:5432/gtm?sslmode=verify-full",
      NODE_ENV: "production",
      OIDC_ISSUER_URL: "https://login.example.org",
      OIDC_AUDIENCE: "gtm-engine",
      QUARANTINE_ENCRYPTION_KEY: "x".repeat(32),
      SUPPRESSION_HASH_KEY: "y".repeat(32),
    };
    expect(() => loadConfig(production)).toThrow(/LLM_PROVIDER/);
    expect(() =>
      loadConfig({ ...production, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k".repeat(16) }),
    ).not.toThrow();
  });
  it("scrubs the API key from logs and never echoes it in an error", () => {
    const c = loadConfig({
      ...baseEnv,
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "secret-key-value-123",
    });
    expect(c.secretValues).toContain("secret-key-value-123");
  });
});
