import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWithContext } from "../src/context.js";
import {
  clearRegisteredSecrets,
  createLogger,
  REDACTED,
  registerSecret,
} from "../src/logging/logger.js";
import { CANARY_SECRET } from "../../../packages/domain/test-support/canaries.js";

function capture() {
  const lines: string[] = [];
  return {
    lines,
    destination: {
      write(line: string) {
        lines.push(line);
      },
    },
  };
}

describe("structured logger redaction", () => {
  beforeEach(() => {
    registerSecret(CANARY_SECRET);
  });
  afterEach(() => {
    clearRegisteredSecrets();
  });

  it("emits one JSON object per line", () => {
    const { lines, destination } = capture();
    const logger = createLogger({ destination });
    logger.info({ route: "/health/live" }, "request completed");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed).toMatchObject({ msg: "request completed", route: "/health/live" });
    expect(typeof parsed.level).toBe("number");
    expect(typeof parsed.time).toBe("number");
  });

  it("redacts sensitive keys in nested objects", () => {
    const { lines, destination } = capture();
    createLogger({ destination }).info(
      { config: { db: { password: CANARY_SECRET }, token: CANARY_SECRET } },
      "loaded",
    );
    expect(lines.join("")).not.toContain(CANARY_SECRET);
    expect(lines.join("")).toContain(REDACTED);
  });

  it("redacts credential headers", () => {
    const { lines, destination } = capture();
    createLogger({ destination }).info(
      {
        req: {
          headers: {
            authorization: `Bearer ${CANARY_SECRET}`,
            cookie: `sid=${CANARY_SECRET}`,
            "x-webhook-signature": CANARY_SECRET,
            "x-request-id": "kept",
          },
        },
      },
      "incoming",
    );
    const out = lines.join("");
    expect(out).not.toContain(CANARY_SECRET);
    expect(out).toContain("kept");
  });

  it("scrubs a registered secret that appears inside an error or free text", () => {
    const { lines, destination } = capture();
    const logger = createLogger({ destination });
    logger.error({ err: new Error(`connect failed using ${CANARY_SECRET}`) }, "db error");
    logger.info(`token is ${CANARY_SECRET} today`);
    logger.warn({ detail: { nested: [`x ${CANARY_SECRET} y`] } }, "nested text");
    expect(lines.join("")).not.toContain(CANARY_SECRET);
  });

  it("scrubs a registered secret that needs JSON escaping", () => {
    const tricky = 'quote"and\\slash-secret-value';
    registerSecret(tricky);
    const { lines, destination } = capture();
    createLogger({ destination }).info({ note: `value ${tricky}` }, "escaped");
    expect(lines.join("")).not.toContain("quote");
    expect(lines.join("")).not.toContain("slash-secret-value");
  });

  it("includes the correlation id of the current request or job", () => {
    const { lines, destination } = capture();
    const logger = createLogger({ destination });
    runWithContext({ correlationId: "corr-12345678" }, () => logger.info("inside"));
    logger.info("outside");
    expect(JSON.parse(lines[0]!)).toMatchObject({ correlationId: "corr-12345678" });
    expect(JSON.parse(lines[1]!)).not.toHaveProperty("correlationId");
  });

  it("does not scrub values that were never registered", () => {
    clearRegisteredSecrets();
    const { lines, destination } = capture();
    createLogger({ destination }).info("plain value visible-12345");
    expect(lines.join("")).toContain("visible-12345");
  });
});
