import { isDataClassification, type DataClassification } from "./classification.js";

// Classification declarations (task T072, spec FR-015): every stored column or request field declares
// exactly one classification, and none may be `prohibited` (prohibited content is never stored).

export type FieldClassification = Readonly<Record<string, DataClassification>>;
export type ClassificationRegistry = Readonly<Record<string, FieldClassification>>;

/** Build a field map from "a, b, c" for one classification: keeps registries short and reviewable. */
export function fields(classification: DataClassification, names: string): FieldClassification {
  return Object.fromEntries(names.split(",").map((n) => [n.trim(), classification]));
}

export function mergeFields(...parts: FieldClassification[]): FieldClassification {
  return Object.assign({}, ...parts) as FieldClassification;
}

export interface ClassificationProblem {
  table: string;
  field?: string;
  problem: "unclassified" | "prohibited" | "invalid" | "stale";
}

/**
 * Compare what exists (table -> field names) with what is declared. `stale` marks declarations for
 * tables or fields that no longer exist, so the registry cannot silently drift.
 */
export function findClassificationProblems(
  actual: Readonly<Record<string, readonly string[]>>,
  declared: ClassificationRegistry,
): ClassificationProblem[] {
  const problems: ClassificationProblem[] = [];
  for (const [table, names] of Object.entries(actual)) {
    const declaredFields = declared[table];
    if (!declaredFields) {
      problems.push({ table, problem: "unclassified" });
      continue;
    }
    for (const field of names) {
      const classification: unknown = declaredFields[field];
      if (classification === undefined) problems.push({ table, field, problem: "unclassified" });
      else if (!isDataClassification(classification))
        problems.push({ table, field, problem: "invalid" });
      else if (classification === "prohibited")
        problems.push({ table, field, problem: "prohibited" });
    }
    for (const field of Object.keys(declaredFields)) {
      if (!names.includes(field)) problems.push({ table, field, problem: "stale" });
    }
  }
  for (const table of Object.keys(declared)) {
    if (!(table in actual)) problems.push({ table, problem: "stale" });
  }
  return problems;
}
