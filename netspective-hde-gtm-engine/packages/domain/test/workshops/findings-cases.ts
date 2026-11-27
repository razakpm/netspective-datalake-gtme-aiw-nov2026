import { readFileSync } from "node:fs";
import { join } from "node:path";

// The acceptance corpus for the finalisation rules (tests/fixtures/workshops/findings-cases.json).
export interface FindingsCase {
  id: string;
  content: Record<string, unknown>;
  expectedShortfalls: { code: string; waivable: boolean }[];
}

export const corpus = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../../../tests/fixtures/workshops/findings-cases.json"),
    "utf8",
  ),
) as { offer1: FindingsCase[]; offer6: FindingsCase[]; intakeFieldNames: string[] };

export const caseById = (list: FindingsCase[], id: string): FindingsCase =>
  structuredClone(list.find((c) => c.id === id)!);
