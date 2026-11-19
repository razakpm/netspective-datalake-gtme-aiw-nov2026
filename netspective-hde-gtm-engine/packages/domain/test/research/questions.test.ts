import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDiscoveryQuestion, sanitizeInterpretation } from "../../src/index.js";

// Task T048: discovery questions never ask for patient-level data; matches only name known capabilities.
describe("discovery questions", () => {
  it("allows questions about field names, source systems, formats and timelines", () => {
    for (const q of [
      "Which ten fields does the pilot depend on, by name?",
      "Which source systems supply each of those fields?",
      "What formats do the real sources use?",
      "When did the pilot stop meeting its targets?",
      "Where could each field's origin be recorded today?",
    ])
      expect(checkDiscoveryQuestion(q), q).toEqual({ ok: true });
  });
  it("refuses questions asking for patient-level data, values, records, rows or samples", () => {
    for (const q of [
      "Can you send us the patient names for the failed cases?",
      "Please share the MRN for a few patients.",
      "What is the SSN format they use? Send an example.",
      "Share the date of birth column.",
      "Can we see a sample of the data?",
      "Send us a few rows from the extract.",
      "Can you share the records that failed?",
      "Please email the file with the real values.",
    ])
      expect(checkDiscoveryQuestion(q), q).toEqual({
        ok: false,
        code: "asks_for_patient_level_data",
      });
  });
  it("accepts the fixture's discovery questions", () => {
    const fixture = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../../tests/fixtures/research/llm/riverbend.json"),
        "utf8",
      ),
    ) as { rules: { task: string; respond?: { discoveryQuestions?: string[] } }[] };
    const qs = fixture.rules.find((r) => r.task === "interpretation")!.respond!.discoveryQuestions!;
    expect(qs).toHaveLength(10);
    for (const q of qs) expect(checkDiscoveryQuestion(q), q).toEqual({ ok: true });
  });
});

describe("sanitizeInterpretation", () => {
  const keys = new Set(["field_lineage_traceability", "data_quality_monitoring"]);
  it("drops matches to unknown capabilities and questions that fail the rule, and counts them", () => {
    const r = sanitizeInterpretation({
      matches: [
        { capabilityKey: "field_lineage_traceability", band: "high", reason: "Fits." },
        { capabilityKey: "made_up_capability", band: "high", reason: "Invented." },
        { capabilityKey: "data_quality_monitoring", band: "medium", reason: "Maybe." },
      ],
      discoveryQuestions: [
        "Which fields does it depend on?",
        "Please send patient names.",
        "Which formats are used?",
      ],
      allowedCapabilityKeys: keys,
    });
    expect(r.matches.map((m) => m.capabilityKey)).toEqual([
      "field_lineage_traceability",
      "data_quality_monitoring",
    ]);
    expect(r.discoveryQuestions).toEqual([
      "Which fields does it depend on?",
      "Which formats are used?",
    ]);
    expect(r.dropped).toEqual({ matches: 1, questions: 1 });
  });
  it("keeps one match per capability, the strongest band first, and is deterministic", () => {
    const input = {
      matches: [
        { capabilityKey: "data_quality_monitoring", band: "low" as const, reason: "a" },
        { capabilityKey: "data_quality_monitoring", band: "high" as const, reason: "b" },
      ],
      discoveryQuestions: [],
      allowedCapabilityKeys: keys,
    };
    const r = sanitizeInterpretation(input);
    expect(r.matches).toEqual([
      { capabilityKey: "data_quality_monitoring", band: "high", reason: "b" },
    ]);
    expect(sanitizeInterpretation(input)).toEqual(r);
  });
});
