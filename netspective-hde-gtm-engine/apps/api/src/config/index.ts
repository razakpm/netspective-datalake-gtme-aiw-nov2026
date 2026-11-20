import { z } from "zod";
import { ConfigError, type ConfigProblem } from "./problems.js";
import { checkEncryptedTransport } from "./tls.js";

export { ConfigError } from "./problems.js";
export type { ConfigProblem } from "./problems.js";

// Typed, fail-fast configuration (spec FR-045, FR-051, FR-053; research R-14, R-16).
//
// Defaults marked HYPOTHESIS come from the source documents and open questions and are starting
// points to be replaced by measured data (constitution XVIII). Every value is overridable through
// the environment. Retention periods are defined ONLY here: the retention registry (task T120) reads
// them from this config and defines no period values of its own.
// Secrets are read from the environment only and are never printed in an error.

const int = (fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const flag = z.enum(["true", "false"]).optional();

/** A decimal amount such as "2.00" (at most 6 decimals), kept as text until converted to micro-units. */
const money = (fallback: string) =>
  z
    .string()
    .regex(/^[0-9]{1,6}(\.[0-9]{1,6})?$/, "must be a decimal amount such as 2.00")
    .default(fallback);

/** Decimal text to integer micro-units, without floating point. */
export function toMicros(amount: string): number {
  const [whole = "0", frac = ""] = amount.split(".");
  return Number(whole) * 1_000_000 + Number(frac.padEnd(6, "0").slice(0, 6));
}

const postgresUrl = z.string({ error: "is required" }).refine(
  (value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "postgres:" || protocol === "postgresql:";
    } catch {
      return false;
    }
  },
  { message: "must be a postgres:// or postgresql:// URL" },
);

const httpUrl = z.string().refine(
  (value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be an http:// or https:// URL" },
);

/** An IANA time zone name, checked with the platform's own tables. */
const timeZone = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid IANA time zone such as UTC or America/New_York" },
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ROLE: z.enum(["http", "worker", "both"]).default("both"),
  PORT: int(3000, 1, 65_535),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: postgresUrl,

  // Request limits (HYPOTHESIS defaults: API 2 MiB, upload 10 MiB, webhook 1 MiB, skew +/-5 min).
  API_BODY_LIMIT_BYTES: int(2_097_152),
  UPLOAD_LIMIT_BYTES: int(10_485_760),
  WEBHOOK_BODY_LIMIT_BYTES: int(1_048_576),
  WEBHOOK_SKEW_SECONDS: int(300),

  // Jobs (HYPOTHESIS defaults: 5 attempts, 30 s base, factor 2, 1 h cap, 5 workers, depth cap 1000).
  JOB_MAX_ATTEMPTS: int(5),
  JOB_BACKOFF_BASE_SECONDS: int(30),
  JOB_BACKOFF_FACTOR: int(2),
  JOB_BACKOFF_CAP_SECONDS: int(3600),
  JOB_CONCURRENCY: int(5),
  JOB_QUEUE_DEPTH_CAP: int(1000),

  // Sessions and invitations (HYPOTHESIS defaults: 8 h absolute, 30 min idle, 7 days).
  SESSION_ABSOLUTE_SECONDS: int(28_800),
  SESSION_IDLE_SECONDS: int(1_800),
  INVITATION_EXPIRY_DAYS: int(7),

  // Retention (spec FR-053; open questions #17 and #24). Audit is removed by whole expired period.
  RETENTION_AUDIT_YEARS: int(7),
  RETENTION_AI_INVOCATION_MONTHS: int(12),
  RETENTION_WEBHOOK_BODY_DAYS: int(90),
  RETENTION_QUARANTINE_DAYS: int(30),
  RETENTION_JOB_DETAIL_DAYS: int(90),
  RETENTION_IDEMPOTENCY_HOURS: int(24),

  // Identity provider and providers. Fakes are for development and tests only (spec FR-045).
  OIDC_ISSUER_URL: httpUrl.optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  USE_FAKE_OIDC: flag,
  USE_FAKE_PROVIDERS: flag,

  // Application-layer key for quarantined content (research R-16, R-19). The value lives in the
  // environment or secret manager, never in the database.
  QUARANTINE_ENCRYPTION_KEY: z.string().min(32).optional(),

  // Feature 002 (HYPOTHESIS defaults: 5 MiB and 5,000 rows per import). The key makes the erasure
  // marker's email hash unguessable; it is required in production.
  SUPPRESSION_HASH_KEY: z.string().min(32).optional(),
  IMPORT_MAX_BYTES: int(5_242_880),
  IMPORT_MAX_ROWS: int(5000),

  // Feature 003 (HYPOTHESIS defaults: excerpt ceiling 300 characters, similarity 0.85, retention 36 months).
  SIGNAL_EXCERPT_MAX_CHARS: int(300, 0, 1000),
  SIGNAL_SIMILARITY_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.85),
  SIGNAL_RETENTION_MONTHS: int(36),
  SIGNAL_FRESHNESS_JOB_ENABLED: flag,
  SIGNAL_RETENTION_JOB_ENABLED: flag,

  // Feature 004 (HYPOTHESIS defaults: 10 sources, 2.00 per run, 20.00 per account per calendar month,
  // 2 repair retries, 90 days to stale, 0.20 per interpretation). Amounts are in the configured currency
  // unit and held as integer micro-units. Rates are micro-units per 1,000 tokens (estimates).
  LLM_PROVIDER: z.enum(["fake", "anthropic"]).default("fake"),
  ANTHROPIC_API_KEY: z.string().min(8).optional(),
  LLM_MODEL_EXTRACTION: z.string().min(1).default("claude-haiku-5-5"),
  LLM_MODEL_SYNTHESIS: z.string().min(1).default("claude-sonnet-5-5"),
  LLM_RATE_EXTRACTION_IN: int(1000, 0),
  LLM_RATE_EXTRACTION_OUT: int(5000, 0),
  LLM_RATE_SYNTHESIS_IN: int(3000, 0),
  LLM_RATE_SYNTHESIS_OUT: int(15000, 0),
  RESEARCH_MAX_SOURCES: int(10, 1, 25),
  RESEARCH_RUN_COST_CAP: money("2.00"),
  RESEARCH_ACCOUNT_MONTHLY_CAP: money("20.00"),
  RESEARCH_MAX_RETRIES: int(2, 0, 5),
  INTERPRETATION_COST_CAP: money("0.20"),
  RESEARCH_WEB_FETCH_ENABLED: flag,
  RESEARCH_FETCH_TIMEOUT_MS: int(10_000, 100),
  RESEARCH_MAX_PAGE_BYTES: int(1_048_576, 1024),
  HYPOTHESIS_STALE_DAYS: int(90),
  // Feature 005 (hypotheses, open question #48).
  BUSINESS_TIME_ZONE: timeZone.default("UTC"),
  OFFER_SCORE_MIN: int(1, 0, 100),
  OFFER_SCORE_MAX: int(5, 1, 100),
  CLAIM_EVIDENCE_DEFAULT_EXPIRY_MONTHS: int(12, 1, 60),
});

type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  env: Env["NODE_ENV"];
  role: Env["APP_ROLE"];
  port: number;
  logLevel: Env["LOG_LEVEL"];
  databaseUrl: string;
  limits: {
    apiBodyBytes: number;
    uploadBytes: number;
    webhookBodyBytes: number;
    webhookSkewSeconds: number;
  };
  jobs: {
    maxAttempts: number;
    backoffBaseSeconds: number;
    backoffFactor: number;
    backoffCapSeconds: number;
    concurrency: number;
    queueDepthCap: number;
  };
  session: { absoluteSeconds: number; idleSeconds: number };
  invitationExpiryDays: number;
  retention: {
    auditYears: number;
    aiInvocationMonths: number;
    webhookBodyDays: number;
    quarantineDays: number;
    jobDetailDays: number;
    idempotencyHours: number;
  };
  oidc: { issuerUrl: string | undefined; audience: string | undefined; useFake: boolean };
  providers: { useFake: boolean };
  quarantineEncryptionKey: string | undefined;
  suppressionHashKey: string;
  imports: { maxBytes: number; maxRows: number };
  signals: {
    excerptMaxChars: number;
    similarityThreshold: number;
    retentionMonths: number;
    freshnessJobEnabled: boolean;
    retentionJobEnabled: boolean;
  };
  llm: {
    provider: "fake" | "anthropic";
    apiKey: string | undefined;
    models: { extraction: string; synthesis: string };
    rates: {
      extraction: { inMicrosPer1k: number; outMicrosPer1k: number };
      synthesis: { inMicrosPer1k: number; outMicrosPer1k: number };
    };
  };
  research: {
    maxSources: number;
    runCapMicros: number;
    accountMonthlyCapMicros: number;
    maxRetries: number;
    interpretationCapMicros: number;
    webFetchEnabled: boolean;
    fetchTimeoutMs: number;
    maxPageBytes: number;
    hypothesisStaleDays: number;
  };
  /** Feature 005 catalogue settings; every value is a hypothesis. */
  catalogue: {
    businessTimeZone: string;
    scoreMin: number;
    scoreMax: number;
    evidenceDefaultExpiryMonths: number;
  };
  /** Values the logger must scrub wherever they appear (see logging/logger.ts). */
  secretValues: string[];
}

function secretsFrom(env: Env): string[] {
  const values: string[] = [];
  try {
    const url = new URL(env.DATABASE_URL);
    if (url.password) values.push(decodeURIComponent(url.password));
  } catch {
    // Reported by the schema check.
  }
  if (env.QUARANTINE_ENCRYPTION_KEY) values.push(env.QUARANTINE_ENCRYPTION_KEY);
  if (env.SUPPRESSION_HASH_KEY) values.push(env.SUPPRESSION_HASH_KEY);
  if (env.ANTHROPIC_API_KEY) values.push(env.ANTHROPIC_API_KEY);
  return values;
}

/** Parse and validate configuration. Throws ConfigError naming every problem; never prints values. */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? "(config)"),
        message: issue.message,
      })),
    );
  }

  const env = parsed.data;
  const production = env.NODE_ENV === "production";
  const problems: ConfigProblem[] = [];

  if (env.OFFER_SCORE_MAX <= env.OFFER_SCORE_MIN) {
    problems.push({ variable: "OFFER_SCORE_MAX", message: "must be greater than OFFER_SCORE_MIN" });
  }

  const useFakeOidc = env.USE_FAKE_OIDC === undefined ? !production : env.USE_FAKE_OIDC === "true";
  const useFakeProviders =
    env.USE_FAKE_PROVIDERS === undefined ? !production : env.USE_FAKE_PROVIDERS === "true";

  if (production) {
    if (useFakeOidc) {
      problems.push({
        variable: "USE_FAKE_OIDC",
        message: "the fake OIDC issuer is not allowed in production",
      });
    }
    if (useFakeProviders) {
      problems.push({
        variable: "USE_FAKE_PROVIDERS",
        message: "fake providers are not allowed in production",
      });
    }
    if (env.OIDC_ISSUER_URL === undefined) {
      problems.push({ variable: "OIDC_ISSUER_URL", message: "is required in production" });
    }
    if (env.OIDC_AUDIENCE === undefined) {
      problems.push({ variable: "OIDC_AUDIENCE", message: "is required in production" });
    }
    if (env.QUARANTINE_ENCRYPTION_KEY === undefined) {
      problems.push({
        variable: "QUARANTINE_ENCRYPTION_KEY",
        message: "is required in production",
      });
    }
    if (env.SUPPRESSION_HASH_KEY === undefined) {
      problems.push({ variable: "SUPPRESSION_HASH_KEY", message: "is required in production" });
    }
    if (env.LLM_PROVIDER === "fake") {
      problems.push({
        variable: "LLM_PROVIDER",
        message: "the fake language model is not allowed in production",
      });
    }
    problems.push(
      ...checkEncryptedTransport({
        databaseUrl: env.DATABASE_URL,
        oidcIssuerUrl: env.OIDC_ISSUER_URL,
      }),
    );
  }

  if (env.LLM_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY === undefined) {
    problems.push({
      variable: "ANTHROPIC_API_KEY",
      message: "is required with LLM_PROVIDER=anthropic",
    });
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    env: env.NODE_ENV,
    role: env.APP_ROLE,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    limits: {
      apiBodyBytes: env.API_BODY_LIMIT_BYTES,
      uploadBytes: env.UPLOAD_LIMIT_BYTES,
      webhookBodyBytes: env.WEBHOOK_BODY_LIMIT_BYTES,
      webhookSkewSeconds: env.WEBHOOK_SKEW_SECONDS,
    },
    jobs: {
      maxAttempts: env.JOB_MAX_ATTEMPTS,
      backoffBaseSeconds: env.JOB_BACKOFF_BASE_SECONDS,
      backoffFactor: env.JOB_BACKOFF_FACTOR,
      backoffCapSeconds: env.JOB_BACKOFF_CAP_SECONDS,
      concurrency: env.JOB_CONCURRENCY,
      queueDepthCap: env.JOB_QUEUE_DEPTH_CAP,
    },
    session: {
      absoluteSeconds: env.SESSION_ABSOLUTE_SECONDS,
      idleSeconds: env.SESSION_IDLE_SECONDS,
    },
    invitationExpiryDays: env.INVITATION_EXPIRY_DAYS,
    retention: {
      auditYears: env.RETENTION_AUDIT_YEARS,
      aiInvocationMonths: env.RETENTION_AI_INVOCATION_MONTHS,
      webhookBodyDays: env.RETENTION_WEBHOOK_BODY_DAYS,
      quarantineDays: env.RETENTION_QUARANTINE_DAYS,
      jobDetailDays: env.RETENTION_JOB_DETAIL_DAYS,
      idempotencyHours: env.RETENTION_IDEMPOTENCY_HOURS,
    },
    oidc: { issuerUrl: env.OIDC_ISSUER_URL, audience: env.OIDC_AUDIENCE, useFake: useFakeOidc },
    providers: { useFake: useFakeProviders },
    quarantineEncryptionKey: env.QUARANTINE_ENCRYPTION_KEY,
    suppressionHashKey:
      env.SUPPRESSION_HASH_KEY ?? "dev-only-suppression-hash-key-not-for-production-use",
    imports: { maxBytes: env.IMPORT_MAX_BYTES, maxRows: env.IMPORT_MAX_ROWS },
    llm: {
      provider: env.LLM_PROVIDER,
      apiKey: env.ANTHROPIC_API_KEY,
      models: { extraction: env.LLM_MODEL_EXTRACTION, synthesis: env.LLM_MODEL_SYNTHESIS },
      rates: {
        extraction: {
          inMicrosPer1k: env.LLM_RATE_EXTRACTION_IN,
          outMicrosPer1k: env.LLM_RATE_EXTRACTION_OUT,
        },
        synthesis: {
          inMicrosPer1k: env.LLM_RATE_SYNTHESIS_IN,
          outMicrosPer1k: env.LLM_RATE_SYNTHESIS_OUT,
        },
      },
    },
    research: {
      maxSources: env.RESEARCH_MAX_SOURCES,
      runCapMicros: toMicros(env.RESEARCH_RUN_COST_CAP),
      accountMonthlyCapMicros: toMicros(env.RESEARCH_ACCOUNT_MONTHLY_CAP),
      maxRetries: env.RESEARCH_MAX_RETRIES,
      interpretationCapMicros: toMicros(env.INTERPRETATION_COST_CAP),
      webFetchEnabled: env.RESEARCH_WEB_FETCH_ENABLED === "true",
      fetchTimeoutMs: env.RESEARCH_FETCH_TIMEOUT_MS,
      maxPageBytes: env.RESEARCH_MAX_PAGE_BYTES,
      hypothesisStaleDays: env.HYPOTHESIS_STALE_DAYS,
    },
    signals: {
      excerptMaxChars: env.SIGNAL_EXCERPT_MAX_CHARS,
      similarityThreshold: env.SIGNAL_SIMILARITY_THRESHOLD,
      retentionMonths: env.SIGNAL_RETENTION_MONTHS,
      freshnessJobEnabled: env.SIGNAL_FRESHNESS_JOB_ENABLED === "true",
      retentionJobEnabled: env.SIGNAL_RETENTION_JOB_ENABLED === "true",
    },
    catalogue: {
      businessTimeZone: env.BUSINESS_TIME_ZONE,
      scoreMin: env.OFFER_SCORE_MIN,
      scoreMax: env.OFFER_SCORE_MAX,
      evidenceDefaultExpiryMonths: env.CLAIM_EVIDENCE_DEFAULT_EXPIRY_MONTHS,
    },
    secretValues: secretsFrom(env),
  };
}
