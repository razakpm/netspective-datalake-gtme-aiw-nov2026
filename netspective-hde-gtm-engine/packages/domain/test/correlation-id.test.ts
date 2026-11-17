import { describe, expect, it } from "vitest";
import {
  CORRELATION_ID_PATTERN,
  isWellFormedCorrelationId,
  resolveCorrelationId,
} from "../src/logging/correlation-id.js";

const generate = () => "generated-id-0001";

describe("correlation id", () => {
  it("preserves a well-formed inbound id", () => {
    expect(resolveCorrelationId("req-12345678", generate)).toBe("req-12345678");
    expect(resolveCorrelationId("A".repeat(64), generate)).toBe("A".repeat(64));
    expect(resolveCorrelationId("a.b_c-d.e1234", generate)).toBe("a.b_c-d.e1234");
  });

  it.each([
    ["too short", "abc"],
    ["too long", "a".repeat(65)],
    ["empty", ""],
    ["newline (log injection)", "abcdefgh\nINJECTED"],
    ["carriage return", "abcdefgh\rINJECTED"],
    ["space", "abcd efgh"],
    ["quote", 'abcdefgh"'],
    ["unicode", "abcdefgh‮"],
    ["slash", "abcdefgh/../x"],
  ])("replaces a malformed id: %s", (_label, value) => {
    expect(isWellFormedCorrelationId(value)).toBe(false);
    expect(resolveCorrelationId(value, generate)).toBe("generated-id-0001");
  });

  it("replaces non-string and repeated header values", () => {
    expect(resolveCorrelationId(undefined, generate)).toBe("generated-id-0001");
    expect(resolveCorrelationId(["req-12345678", "req-87654321"], generate)).toBe(
      "generated-id-0001",
    );
    expect(resolveCorrelationId(12345678, generate)).toBe("generated-id-0001");
  });

  it("documents the accepted shape", () => {
    expect(CORRELATION_ID_PATTERN.source).toBe("^[A-Za-z0-9._-]{8,64}$");
  });
});
