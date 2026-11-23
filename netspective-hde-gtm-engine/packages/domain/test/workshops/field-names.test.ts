import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeFieldName } from "../../src/workshops/intake.js";

// Task T062 (spec FR-026, research R-12): an entry must read as a field name, never as a value.
const corpus = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../../../tests/fixtures/intake/field-names.json"),
    "utf8",
  ),
) as { accepted: string[]; refused: { value: string; reason: string }[] };

describe("looksLikeFieldName over the fixture corpus", () => {
  it.each(corpus.accepted)("accepts the field name %j", (value) => {
    expect(looksLikeFieldName(value)).toEqual({ ok: true });
  });
  it.each(corpus.refused)(
    "refuses the value $value with the reason $reason",
    ({ value, reason }) => {
      expect(looksLikeFieldName(value)).toEqual({ ok: false, reason });
    },
  );
  it("keeps the corpus honest: it names every reason the rule can give", () => {
    const reasons = new Set(corpus.refused.map((r) => r.reason));
    for (const r of [
      "empty",
      "too_long",
      "email",
      "long_number",
      "date_shape",
      "too_many_words",
      "sentence",
      "row_or_quote",
      "number_token",
    ]) {
      expect(reasons.has(r), r).toBe(true);
    }
  });
});
