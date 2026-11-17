import { z } from "zod";

// Web app configuration (tasks T014, T016). Session lifetimes and OIDC settings are added with the
// sign-in task. Messages name settings only and never include their values.

export interface WebConfigProblem {
  variable: string;
  message: string;
}

export class WebConfigError extends Error {
  readonly problems: readonly WebConfigProblem[];

  constructor(problems: readonly WebConfigProblem[]) {
    super(
      `Invalid web configuration: ${problems.map((p) => `${p.variable} (${p.message})`).join("; ")}`,
    );
    this.name = "WebConfigError";
    this.problems = problems;
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_BASE_URL: z.string({ error: "is required" }).refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "must be an http:// or https:// URL" },
  ),
});

export interface WebConfig {
  env: "development" | "test" | "production";
  apiBaseUrl: string;
}

/** Parse and validate web configuration. In production the web-to-API connection must use https. */
export function loadWebConfig(source: Record<string, string | undefined> = process.env): WebConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new WebConfigError(
      parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? "(config)"),
        message: issue.message,
      })),
    );
  }

  const { NODE_ENV, API_BASE_URL } = parsed.data;
  if (NODE_ENV === "production" && new URL(API_BASE_URL).protocol !== "https:") {
    throw new WebConfigError([
      { variable: "API_BASE_URL", message: "must use https in production" },
    ]);
  }
  return { env: NODE_ENV, apiBaseUrl: API_BASE_URL };
}
