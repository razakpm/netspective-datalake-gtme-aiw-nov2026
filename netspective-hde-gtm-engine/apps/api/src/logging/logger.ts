import pino, { type DestinationStream, type Logger } from "pino";
import { getCorrelationId } from "../context.js";
import { scrubPhiFromLine } from "./phi-serializer.js";

// Structured logs with redaction (spec FR-034, FR-035; research R-12). Two layers:
//  1. Key-based redaction for well-known sensitive field names, at any depth we expect to see.
//  2. Value-based scrubbing of registered secrets, applied to every serialised line, so a secret
//     that appears inside an error message or a free-text string is removed too.
// PHI-like content is replaced by the guard-backed serializer (phi-serializer.ts).

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = [
  "password",
  "passwd",
  "secret",
  "clientSecret",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "apiKey",
  "authorization",
  "cookie",
  "signature",
  "databaseUrl",
  "quarantineEncryptionKey",
  "privateKey",
];

function redactionPaths(): string[] {
  const paths: string[] = [];
  for (const key of SENSITIVE_KEYS) {
    paths.push(key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`);
  }
  for (const prefix of ["req.headers", "res.headers", "headers"]) {
    paths.push(
      `${prefix}.authorization`,
      `${prefix}.cookie`,
      `${prefix}["set-cookie"]`,
      `${prefix}["x-webhook-signature"]`,
    );
  }
  return paths;
}

const secrets = new Set<string>();

/** Register a value that must never appear in log output. Very short values are ignored. */
export function registerSecret(value: string | undefined): void {
  if (value !== undefined && value.length >= 8) secrets.add(value);
}

export function registerSecrets(values: readonly string[]): void {
  for (const value of values) registerSecret(value);
}

/** Test helper: forget every registered secret. */
export function clearRegisteredSecrets(): void {
  secrets.clear();
}

/** Remove registered secret values from any text (used by logs and by redacted job errors). */
export function scrubSecrets(text: string): string {
  return scrub(text);
}

function scrub(line: string): string {
  let out = line;
  for (const secret of secrets) {
    out = out.split(secret).join(REDACTED);
    // The same value as it appears inside a JSON string literal.
    const escaped = JSON.stringify(secret).slice(1, -1);
    if (escaped !== secret) out = out.split(escaped).join(REDACTED);
  }
  return out;
}

export interface LoggerOptions {
  level?: string;
  /** Where lines go. Defaults to standard output. Tests pass a capture stream. */
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink: DestinationStream = options.destination ?? {
    write: (line: string) => {
      process.stdout.write(line);
    },
  };

  return pino(
    {
      level: options.level ?? "info",
      redact: { paths: redactionPaths(), censor: REDACTED },
      mixin: () => {
        const correlationId = getCorrelationId();
        return correlationId === undefined ? {} : { correlationId };
      },
    },
    { write: (line: string) => sink.write(scrubPhiFromLine(scrub(line))) },
  );
}
