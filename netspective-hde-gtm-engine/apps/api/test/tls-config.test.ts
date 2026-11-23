import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/index.js";
import { CANARY_SECRET } from "../../../packages/domain/test-support/canaries.js";

// Encrypted transport is enforced when the system starts in production (spec FR-051, SC-012).

const compliant = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://gtm:pw@db.example.org:5432/gtm?sslmode=verify-full",
  OIDC_ISSUER_URL: "https://login.example.org",
  OIDC_AUDIENCE: "gtm-engine",
  QUARANTINE_ENCRYPTION_KEY: "k".repeat(32),
  SUPPRESSION_HASH_KEY: "s".repeat(32),
  DOWNLOAD_SIGNING_KEY: "d".repeat(32),
  FORM_TOKEN_KEY: "f".repeat(32),
  LLM_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "k".repeat(16),
};

function problemsFor(
  env: Record<string, string>,
): readonly { variable: string; message: string }[] {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    return (error as ConfigError).problems;
  }
}

describe("encrypted transport enforcement", () => {
  it("starts with a compliant production configuration", () => {
    expect(() => loadConfig({ ...compliant })).not.toThrow();
  });

  it.each(["require", "verify-ca", "verify-full"])("accepts database sslmode=%s", (mode) => {
    const env = {
      ...compliant,
      DATABASE_URL: `postgres://gtm:pw@db.example.org/gtm?sslmode=${mode}`,
    };
    expect(problemsFor(env)).toEqual([]);
  });

  it.each([
    ["no sslmode", "postgres://gtm:pw@db.example.org:5432/gtm"],
    ["sslmode=disable", "postgres://gtm:pw@db.example.org:5432/gtm?sslmode=disable"],
    ["sslmode=prefer", "postgres://gtm:pw@db.example.org:5432/gtm?sslmode=prefer"],
    ["sslmode=allow", "postgres://gtm:pw@db.example.org:5432/gtm?sslmode=allow"],
  ])("refuses a production database URL with %s", (_label, url) => {
    const problems = problemsFor({ ...compliant, DATABASE_URL: url });
    expect(problems.map((p) => p.variable)).toContain("DATABASE_URL");
  });

  it("refuses a non-https OIDC issuer in production", () => {
    const problems = problemsFor({ ...compliant, OIDC_ISSUER_URL: "http://login.example.org" });
    expect(problems.map((p) => p.variable)).toContain("OIDC_ISSUER_URL");
  });

  it("names the setting and never prints credentials", () => {
    const env = {
      ...compliant,
      DATABASE_URL: `postgres://gtm:${CANARY_SECRET}@db.example.org:5432/gtm?sslmode=disable`,
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

  it("allows plain localhost connections in development and test", () => {
    for (const nodeEnv of ["development", "test"]) {
      const env = {
        NODE_ENV: nodeEnv,
        DATABASE_URL: "postgres://gtm:pw@localhost:5432/gtm",
        OIDC_ISSUER_URL: "http://localhost:4010",
      };
      expect(problemsFor(env)).toEqual([]);
    }
  });
});
