// Browser-side client for the research API (contracts/research.openapi.yaml) and plain-language errors.
// Amounts are decimal strings in the configured currency unit; errors never show the server's own text.

export type RunState =
  | "queued"
  | "running"
  | "completed"
  | "budget_reached"
  | "needs_attention"
  | "failed"
  | "cancelled";

export interface RunView {
  id: string;
  accountId: string;
  state: RunState;
  trigger: "manual" | "schedule";
  stopReason: string | null;
  icpExcluded: boolean;
  budget: { maxSources: number; maxCost: string };
  totals: {
    sourcesRead: number;
    cost: string;
    retries: number;
    injectionFlags: number;
    droppedFindings: {
      uncited: number;
      unsupported: number;
      protectedTopic: number;
      taxonomy: number;
    };
  };
  attention: {
    acknowledgedBy: string | null;
    acknowledgedAt: string | null;
    note: string | null;
  } | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Finding {
  id: string;
  kind: "fact" | "inference" | "unknown" | "contradiction";
  topic: string;
  statement: string;
  extractionConfidence: "low" | "medium" | "high";
  verified: boolean;
  carriedOver: boolean;
  flaggedSource: boolean;
  source: { fetchId: string; address: string } | null;
  secondSource: { fetchId: string; address: string } | null;
}

export interface AccountSummary {
  accountId: string;
  runId: string | null;
  label: string;
  facts: Finding[];
  inferences: Finding[];
  unknowns: { topic: string; statement: string }[];
  contradictions: Finding[];
  sources: { fetchId: string; address: string; flagged: boolean }[];
}

export interface StartRunBody {
  maxSources?: number;
  maxCost?: string;
  sources?: { address: string; capturedText?: string }[];
}

export class ResearchApiError extends Error {
  constructor(
    readonly status: number,
    readonly codes: string[] = [],
  ) {
    super(`request failed (${status})`);
    this.name = "ResearchApiError";
  }
}

const REASONS: Record<string, string> = {
  run_already_active: "A run is already active for this account.",
  account_cap_exceeded: "This account has used its research allowance for the month.",
  max_cost_above_run_cap: "The cost limit is above the per-run cap.",
  max_sources_above_limit: "The source limit is above the maximum.",
  invalid_source_address: "One of the addresses is not a valid https address.",
  phi_guard: "The text looks like it may contain patient information and was not accepted.",
};

/** A message safe to show a person: a known reason, else a generic line; never the server's own detail. */
export function describeResearchError(error: unknown): string {
  if (error instanceof ResearchApiError) {
    const known = error.codes.map((c) => REASONS[c]).find(Boolean);
    if (known) return known;
    if (error.status === 403) return "You do not have permission to do that.";
    if (error.status === 404) return "That no longer exists.";
    if (error.status === 409)
      return "That change conflicts with the current state. Refresh and try again.";
    if (error.status === 400 || error.status === 422)
      return "Please check the details and try again.";
  }
  return "Something went wrong. Please try again.";
}

export const newKey = (): string => globalThis.crypto.randomUUID();

export async function call<T>(
  method: string,
  path: string,
  key?: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: string };
    // Only reason codes we know are ever looked up; the detail text itself is never shown.
    const codes = [...(problem.detail ?? "").matchAll(/[a-z_]+(?::[a-z]+)?/g)]
      .map((m) => m[0])
      .filter((c) => c in REASONS || c.includes("_"));
    throw new ResearchApiError(response.status, codes);
  }
  return (await response.json()) as T;
}
