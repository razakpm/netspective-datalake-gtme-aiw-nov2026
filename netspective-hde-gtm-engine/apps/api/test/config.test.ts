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
      DOWNLOAD_SIGNING_KEY: "d".repeat(32),
      FORM_TOKEN_KEY: "f".repeat(32),
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "k".repeat(16),
      PDF_RENDERER: "playwright",
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
      DOWNLOAD_SIGNING_KEY: "d".repeat(32),
      FORM_TOKEN_KEY: "f".repeat(32),
    };
    expect(() => loadConfig(production)).toThrow(/LLM_PROVIDER/);
    expect(() =>
      loadConfig({
        ...production,
        LLM_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: "k".repeat(16),
        PDF_RENDERER: "playwright",
      }),
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

describe("feature 005 configuration (hypotheses)", () => {
  it("defaults to UTC, a 1 to 5 score scale and 12 months of evidence expiry", () => {
    expect(loadConfig({ ...baseEnv }).catalogue).toEqual({
      businessTimeZone: "UTC",
      scoreMin: 1,
      scoreMax: 5,
      evidenceDefaultExpiryMonths: 12,
    });
  });
  it("lets the environment override each value", () => {
    expect(
      loadConfig({
        ...baseEnv,
        BUSINESS_TIME_ZONE: "America/New_York",
        OFFER_SCORE_MIN: "0",
        OFFER_SCORE_MAX: "10",
        CLAIM_EVIDENCE_DEFAULT_EXPIRY_MONTHS: "6",
      }).catalogue,
    ).toEqual({
      businessTimeZone: "America/New_York",
      scoreMin: 0,
      scoreMax: 10,
      evidenceDefaultExpiryMonths: 6,
    });
  });
  it("rejects an unknown time zone, a score max not above the min and bad month counts", () => {
    expect(() => loadConfig({ ...baseEnv, BUSINESS_TIME_ZONE: "Mars/Olympus" })).toThrow(
      /BUSINESS_TIME_ZONE/,
    );
    expect(() => loadConfig({ ...baseEnv, OFFER_SCORE_MIN: "5", OFFER_SCORE_MAX: "5" })).toThrow(
      /OFFER_SCORE_MAX/,
    );
    for (const bad of ["0", "61", "1.5", "x"]) {
      expect(() => loadConfig({ ...baseEnv, CLAIM_EVIDENCE_DEFAULT_EXPIRY_MONTHS: bad })).toThrow(
        /CLAIM_EVIDENCE_DEFAULT_EXPIRY_MONTHS/,
      );
    }
  });
});

describe("feature 006 configuration (hypotheses)", () => {
  it("has the documented defaults", () => {
    const { routing } = loadConfig({ ...baseEnv });
    expect(routing).toMatchObject({
      publicFormOrigins: [],
      postRateLimitPerMinute: 20,
      getRateLimitPerMinute: 120,
      formMinSeconds: 3,
      formMaxAgeHours: 24,
      dedupeSeconds: 60,
      registerLinkTtlHours: 24,
      recommendationAi: false,
      supportedMinBand: "medium",
    });
  });
  it("splits and trims the origin allow-list and lets the environment override values", () => {
    const { routing } = loadConfig({
      ...baseEnv,
      PUBLIC_FORM_ORIGINS: " https://www.example.org , https://forms.example.org ,",
      REGISTER_LINK_TTL_HOURS: "48",
      RECOMMENDATION_AI: "on",
      SUPPORTED_MIN_BAND: "high",
    });
    expect(routing.publicFormOrigins).toEqual([
      "https://www.example.org",
      "https://forms.example.org",
    ]);
    expect(routing.registerLinkTtlHours).toBe(48);
    expect(routing.recommendationAi).toBe(true);
    expect(routing.supportedMinBand).toBe("high");
  });
  it("rejects non-integer, negative and unknown values", () => {
    for (const [name, bad] of [
      ["FORM_MIN_SECONDS", "-1"],
      ["FORM_MAX_AGE_HOURS", "0"],
      ["PUBLIC_DEDUPE_SECONDS", "1.5"],
      ["REGISTER_LINK_TTL_HOURS", "x"],
      ["SUPPORTED_MIN_BAND", "extreme"],
      ["RECOMMENDATION_AI", "maybe"],
      ["FORM_TOKEN_KEY", "short"],
    ] as const) {
      expect(() => loadConfig({ ...baseEnv, [name]: bad })).toThrow(new RegExp(name));
    }
  });
  it("requires both signing keys in production and scrubs them from logs", () => {
    const prod = { ...baseEnv, NODE_ENV: "production" };
    const needed = [
      "OIDC_ISSUER_URL",
      "OIDC_AUDIENCE",
      "QUARANTINE_ENCRYPTION_KEY",
      "SUPPRESSION_HASH_KEY",
      "DOWNLOAD_SIGNING_KEY",
      "FORM_TOKEN_KEY",
    ];
    try {
      loadConfig(prod);
      throw new Error("expected a ConfigError");
    } catch (error) {
      const variables = (error as { problems?: { variable: string }[] }).problems?.map(
        (p) => p.variable,
      );
      expect(variables).toEqual(expect.arrayContaining(needed));
    }
    const c = loadConfig({
      ...baseEnv,
      DOWNLOAD_SIGNING_KEY: "d".repeat(32),
      FORM_TOKEN_KEY: "f".repeat(32),
    });
    expect(c.secretValues).toEqual(expect.arrayContaining(["d".repeat(32), "f".repeat(32)]));
  });
});

describe("feature 007 configuration (hypotheses)", () => {
  const google = {
    CALENDAR_PROVIDER: "google",
    CALENDAR_GOOGLE_ENABLED: "true",
    GOOGLE_CALENDAR_ID: "workshops-calendar.example",
    GOOGLE_CLIENT_ID: "client-id.example",
    GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
    GOOGLE_REFRESH_TOKEN: "synthetic-refresh-token",
  };
  const production = {
    ...baseEnv,
    DATABASE_URL: "postgres://gtm:x@db.example.org:5432/gtm?sslmode=verify-full",
    NODE_ENV: "production",
    OIDC_ISSUER_URL: "https://login.example.org",
    OIDC_AUDIENCE: "gtm-engine",
    QUARANTINE_ENCRYPTION_KEY: "x".repeat(32),
    SUPPRESSION_HASH_KEY: "y".repeat(32),
    DOWNLOAD_SIGNING_KEY: "d".repeat(32),
    FORM_TOKEN_KEY: "f".repeat(32),
    LLM_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "k".repeat(16),
    PDF_RENDERER: "playwright",
  };
  const variables = (env: Record<string, string>): string[] => {
    try {
      loadConfig(env);
      return [];
    } catch (error) {
      return (error as ConfigError).problems.map((p) => p.variable);
    }
  };

  it("has the documented defaults: everything external is off", () => {
    const c = loadConfig({ ...baseEnv });
    expect(c.calendar).toEqual({ provider: "none", google: undefined });
    expect(c.workshops).toEqual({
      ai: false,
      aiCapMicros: 200_000,
      pdfRenderer: "fake",
      minutes: { offer1: 45, offer6: 90 },
      artifactMaxBytes: 1_048_576,
      artifactKinds: [
        "specification",
        "timeline",
        "scrubbed_rejection_log",
        "interface_description",
        "field_list",
        "other_non_phi",
      ],
      uploadQuarantine: true,
      retentionMonths: 12,
      retentionJobEnabled: false,
      outputMaxChars: 3500,
    });
  });
  it("lets the environment override each value", () => {
    const c = loadConfig({
      ...baseEnv,
      CALENDAR_PROVIDER: "fake",
      WORKSHOP_AI: "on",
      WORKSHOP_AI_CAP: "0.05",
      PDF_RENDERER: "playwright",
      WORKSHOP_MINUTES_OFFER_1: "30",
      WORKSHOP_MINUTES_OFFER_6: "120",
      WORKSHOP_ARTIFACT_MAX_BYTES: "2048",
      WORKSHOP_ARTIFACT_KINDS: " specification , timeline ,",
      WORKSHOP_UPLOAD_QUARANTINE: "false",
      WORKSHOP_RETENTION_MONTHS: "6",
      WORKSHOP_RETENTION_JOB_ENABLED: "true",
      OUTPUT_MAX_CHARS: "2000",
    });
    expect(c.calendar.provider).toBe("fake");
    expect(c.workshops).toEqual({
      ai: true,
      aiCapMicros: 50_000,
      pdfRenderer: "playwright",
      minutes: { offer1: 30, offer6: 120 },
      artifactMaxBytes: 2048,
      artifactKinds: ["specification", "timeline"],
      uploadQuarantine: false,
      retentionMonths: 6,
      retentionJobEnabled: true,
      outputMaxChars: 2000,
    });
  });
  it("takes the model cap from the interpretation cap when it has none of its own", () => {
    const c = loadConfig({ ...baseEnv, INTERPRETATION_COST_CAP: "0.10" });
    expect(c.workshops.aiCapMicros).toBe(100_000);
  });
  it("rejects out-of-range and malformed values", () => {
    for (const [name, bad] of [
      ["CALENDAR_PROVIDER", "outlook"],
      ["WORKSHOP_AI", "yes"],
      ["WORKSHOP_AI_CAP", "free"],
      ["PDF_RENDERER", "wkhtml"],
      ["WORKSHOP_MINUTES_OFFER_1", "14"],
      ["WORKSHOP_MINUTES_OFFER_6", "241"],
      ["WORKSHOP_ARTIFACT_MAX_BYTES", "0"],
      ["WORKSHOP_ARTIFACT_KINDS", " , "],
      ["WORKSHOP_ARTIFACT_KINDS", "Patient Extract"],
      ["WORKSHOP_RETENTION_MONTHS", "121"],
      ["OUTPUT_MAX_CHARS", "10"],
    ] as const) {
      expect(() => loadConfig({ ...baseEnv, [name]: bad })).toThrow(new RegExp(name));
    }
  });
  it("uses Google only with the switch and all four credentials", () => {
    expect(loadConfig({ ...baseEnv, ...google }).calendar.google).toEqual({
      calendarId: "workshops-calendar.example",
      clientId: "client-id.example",
      clientSecret: "synthetic-client-secret",
      refreshToken: "synthetic-refresh-token",
    });
    expect(variables({ ...baseEnv, ...google, CALENDAR_GOOGLE_ENABLED: "false" })).toContain(
      "CALENDAR_GOOGLE_ENABLED",
    );
    expect(variables({ ...baseEnv, CALENDAR_PROVIDER: "google" })).toEqual([
      "CALENDAR_GOOGLE_ENABLED",
      "GOOGLE_CALENDAR_ID",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REFRESH_TOKEN",
    ]);
    // Credentials left in the environment do nothing while the provider is not google.
    const off = loadConfig({ ...baseEnv, ...google, CALENDAR_PROVIDER: "none" });
    expect(off.calendar.google).toBeUndefined();
  });
  it("scrubs the four Google values from logs", () => {
    const c = loadConfig({ ...baseEnv, ...google });
    expect(c.secretValues).toEqual(
      expect.arrayContaining([
        google.GOOGLE_CALENDAR_ID,
        google.GOOGLE_CLIENT_ID,
        google.GOOGLE_CLIENT_SECRET,
        google.GOOGLE_REFRESH_TOKEN,
      ]),
    );
  });
  it("refuses the fake calendar and the fake PDF renderer in production", () => {
    expect(variables(production)).toEqual([]);
    expect(variables({ ...production, CALENDAR_PROVIDER: "fake" })).toEqual(["CALENDAR_PROVIDER"]);
    expect(variables({ ...production, PDF_RENDERER: "fake" })).toEqual(["PDF_RENDERER"]);
    const unset: Record<string, string> = { ...production };
    delete unset["PDF_RENDERER"];
    expect(variables(unset)).toEqual(["PDF_RENDERER"]);
  });
});
