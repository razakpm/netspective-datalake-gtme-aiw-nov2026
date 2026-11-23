import { evaluate } from "./evaluate.js";
import type { RuleSet } from "./rules.js";
import {
  DEFAULT_ROUTING_CONFIG,
  type Evaluation,
  type RoutingConfig,
  type RoutingContext,
} from "./types.js";

// Runs the routing case corpus against a rule set (research R-07). Rule set activation calls this: a
// rule set with a failing case cannot be activated (spec FR-013). Pure.

export interface CorpusCase {
  id: string;
  rule: string;
  kind: "match" | "near_miss" | "precedence" | "eligibility";
  patch: Record<string, unknown>;
  expected: {
    outcome: string;
    offer: string | null;
    matched: string[];
    chosen: string | null;
    eligible: string[];
    excluded: string[];
    outreach: string;
    limitationsInclude?: string[];
    alternatives?: string[];
  };
}

export interface Corpus {
  offerKeys: Record<string, string>;
  base: unknown;
  cases: CorpusCase[];
}

function merge(base: unknown, patch: unknown): unknown {
  if (
    patch !== null &&
    typeof patch === "object" &&
    !Array.isArray(patch) &&
    base !== null &&
    typeof base === "object" &&
    !Array.isArray(base)
  ) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>))
      out[k] = merge(out[k], v);
    return out;
  }
  return patch;
}

export function contextOf(corpus: Corpus, c: CorpusCase): RoutingContext {
  return merge(corpus.base, c.patch) as RoutingContext;
}

function describe(ev: Evaluation, corpus: Corpus) {
  const alias = (key: string | null) =>
    key === null ? null : (Object.entries(corpus.offerKeys).find(([, v]) => v === key)?.[0] ?? key);
  return {
    outcome: ev.outcome,
    offer: alias(ev.offerKey),
    matched: ev.matched.map((m) => m.ruleId),
    chosen: ev.chosenRuleId,
    eligible: ev.eligible.map((e) => alias(e.offerKey) as string).sort(),
    excluded: ev.excluded.map((e) => `${e.offerKey}:${e.code}`).sort(),
    outreach: ev.outreach.allowed ? "allowed" : `blocked:${ev.outreach.reasons.join(",")}`,
    alternatives: ev.alternatives.map((a) => `${a.kind}:${a.offerKey ?? ""}`),
  };
}

export function runCorpus(
  ruleSet: RuleSet,
  version: number,
  corpus: Corpus,
  config: RoutingConfig = DEFAULT_ROUTING_CONFIG,
): { total: number; failures: string[] } {
  const failures: string[] = [];
  for (const c of corpus.cases) {
    const ev = evaluate(contextOf(corpus, c), ruleSet, version, config);
    const got = describe(ev, corpus);
    const want = c.expected;
    const problems: string[] = [];
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (got.outcome !== want.outcome) problems.push(`outcome ${got.outcome} != ${want.outcome}`);
    if (got.offer !== want.offer) problems.push(`offer ${got.offer} != ${want.offer}`);
    if (!same(got.matched, want.matched))
      problems.push(`matched ${got.matched} != ${want.matched}`);
    if (got.chosen !== want.chosen) problems.push(`chosen ${got.chosen} != ${want.chosen}`);
    if (!same(got.eligible, [...want.eligible].sort()))
      problems.push(`eligible ${got.eligible} != ${want.eligible}`);
    if (!same(got.excluded, [...want.excluded].sort()))
      problems.push(`excluded ${got.excluded} != ${want.excluded}`);
    if (got.outreach !== want.outreach)
      problems.push(`outreach ${got.outreach} != ${want.outreach}`);
    if (want.alternatives && !same(got.alternatives, want.alternatives))
      problems.push(`alternatives ${got.alternatives} != ${want.alternatives}`);
    for (const text of want.limitationsInclude ?? []) {
      if (!ev.limitations.some((l) => l.includes(text)))
        problems.push(`limitation missing: ${text}`);
    }
    if (problems.length > 0) failures.push(`${c.id}: ${problems.join("; ")}`);
  }
  return { total: corpus.cases.length, failures };
}
