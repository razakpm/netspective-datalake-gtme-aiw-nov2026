import { isPatientRowArray, TEXT_RULES } from "./detectors.js";

// The shared PHI-boundary guard (constitution Principles IV and IX). It is a pure function: the same
// input and options always give the same decision. A decision carries rule ids and the guard version,
// never any of the inspected content, so it is safe to log, audit and store.

/** Bump whenever any detector rule changes, so a stored decision names the rules that produced it. */
export const GUARD_VERSION = "guard-2026.11.2";

export type GuardAction = "reject" | "quarantine";

export interface GuardDecision {
  decision: "allow" | GuardAction;
  rule_ids: string[];
  guard_version: string;
}

export interface GuardOptions {
  /** What a match produces. Reject by default; quarantine only where policy says so (policy.ts). */
  onMatch?: GuardAction;
  /** Maximum total text size inspected, in UTF-16 code units. Larger input is unclassifiable. */
  maxBytes?: number;
  /** Maximum object nesting depth. Deeper input is unclassifiable. */
  maxDepth?: number;
}

const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_MAX_DEPTH = 20;
const UNCLASSIFIABLE = "GUARD.UNCLASSIFIABLE";

function decide(ruleIds: Set<string>, onMatch: GuardAction): GuardDecision {
  const sorted = [...ruleIds].sort();
  return {
    decision: sorted.length === 0 ? "allow" : onMatch,
    rule_ids: sorted,
    guard_version: GUARD_VERSION,
  };
}

function runTextRules(text: string, found: Set<string>): void {
  for (const rule of TEXT_RULES) {
    if (rule.matches(text)) found.add(rule.id);
  }
}

/** Inspect one string. */
export function guardText(text: string, options: GuardOptions = {}): GuardDecision {
  return guardValue(text, options);
}

/** Inspect any JSON-like value: strings, arrays and plain objects, recursively. */
export function guardValue(value: unknown, options: GuardOptions = {}): GuardDecision {
  const onMatch = options.onMatch ?? "reject";
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const found = new Set<string>();
  const seen = new WeakSet<object>();
  let inspected = 0;
  let unclassifiable = false;

  // A string that is itself JSON (a query parameter, a header or a stored blob) is inspected as the
  // structure it encodes, so tabular rows and nested fields hidden inside it are still found.
  const visitEmbeddedJson = (text: string, depth: number): void => {
    const first = text.trimStart()[0];
    if (first !== "{" && first !== "[") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (parsed !== null && typeof parsed === "object") visit(parsed, depth + 1);
  };

  const visit = (node: unknown, depth: number): void => {
    if (unclassifiable) return;
    if (depth > maxDepth) {
      unclassifiable = true;
      return;
    }
    switch (typeof node) {
      case "string": {
        inspected += node.length;
        if (inspected > maxBytes || node.includes("\u0000")) {
          unclassifiable = true;
          return;
        }
        runTextRules(node, found);
        visitEmbeddedJson(node, depth);
        return;
      }
      case "number":
      case "boolean":
      case "undefined":
        return;
      case "object": {
        if (node === null) return;
        if (seen.has(node) || ArrayBuffer.isView(node) || node instanceof ArrayBuffer) {
          unclassifiable = true;
          return;
        }
        seen.add(node);
        if (Array.isArray(node)) {
          if (isPatientRowArray(node)) found.add("PHI.TABULAR_ROWS");
          for (const item of node) visit(item, depth + 1);
          return;
        }
        const entries = Object.entries(node as Record<string, unknown>);
        // Flatten this object's own primitive fields into one block so label-based rules
        // (name, DOB, MRN, password) can see key and value together.
        const flat: string[] = [];
        for (const [key, child] of entries) {
          if (typeof child === "string" || typeof child === "number") flat.push(`${key}: ${child}`);
        }
        if (flat.length > 0) visit(flat.join("\n"), depth + 1);
        for (const [key, child] of entries) {
          visit(key, depth + 1);
          // Strings and numbers were already inspected through the flattened block above. Everything
          // else (nested objects, and values that cannot be classified such as bigint, function and
          // symbol) must be visited so it is either inspected or rejected as unclassifiable.
          if (typeof child !== "string" && typeof child !== "number") visit(child, depth + 1);
          else if (typeof child === "string") visitEmbeddedJson(child, depth);
        }
        return;
      }
      default:
        // bigint, function, symbol: cannot be classified.
        unclassifiable = true;
    }
  };

  visit(value, 0);
  if (unclassifiable) found.add(UNCLASSIFIABLE);
  return decide(found, onMatch);
}
