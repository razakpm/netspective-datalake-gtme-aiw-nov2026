import type { ConfigProblem } from "./problems.js";

// Encrypted transport enforcement (spec FR-051, SC-012). In production the process refuses to start
// unless the database connection requires TLS and the identity provider is reached over https.
// Messages name the setting only; they never include the URL, so credentials cannot leak.

const TLS_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

export function checkEncryptedTransport(input: {
  databaseUrl: string;
  oidcIssuerUrl?: string | undefined;
}): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  try {
    const url = new URL(input.databaseUrl);
    const sslmode = url.searchParams.get("sslmode");
    const ssl = url.searchParams.get("ssl");
    const encrypted = (sslmode !== null && TLS_SSL_MODES.has(sslmode)) || ssl === "true";
    if (!encrypted) {
      problems.push({
        variable: "DATABASE_URL",
        message: "must require TLS in production (use sslmode=require, verify-ca or verify-full)",
      });
    }
  } catch {
    // An unparseable URL is reported by the schema check; nothing more to say here.
  }

  if (input.oidcIssuerUrl !== undefined) {
    let isHttps = false;
    try {
      isHttps = new URL(input.oidcIssuerUrl).protocol === "https:";
    } catch {
      // Reported by the schema check.
    }
    if (!isHttps) {
      problems.push({ variable: "OIDC_ISSUER_URL", message: "must use https in production" });
    }
  }

  return problems;
}
