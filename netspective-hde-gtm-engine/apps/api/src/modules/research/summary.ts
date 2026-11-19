import { AccountResearchSummarySchema, type AccountResearchSummary } from "@gtm/ai-contracts";
import { PROTECTED_RESEARCH_TOPICS } from "@gtm/domain";

// Deterministic summary assembly (feature 004, plan note: the summary is composed from verified findings,
// not written by the model). Carried-over findings from sources skipped as unchanged are included and marked.

export interface SummaryFinding {
  id: string;
  key: string;
  kind: "fact" | "inference" | "contradiction";
  topic: string;
  statement: string;
  supportingText: string | null;
  sourceFetchId: string | null;
  secondSourceFetchId: string | null;
  basisIds: string[];
  confidence: "low" | "medium" | "high";
  carriedOver: boolean;
}

const TOPIC_LABEL: Record<string, string> = {
  data_architecture: "data architecture",
  source_systems: "source systems",
  budget: "budget",
  project_status: "project status",
  buying_authority: "buying authority",
};

export function assembleSummary(input: {
  findings: readonly SummaryFinding[];
  modelUnknowns: readonly { topic: string; statement: string }[];
  sources: readonly { fetchId: string; flagged: boolean }[];
}): AccountResearchSummary {
  const facts = input.findings.filter((f) => f.kind === "fact" && f.sourceFetchId);
  const unknowns: { topic: string; statement: string }[] = [];
  for (const topic of PROTECTED_RESEARCH_TOPICS) {
    if (facts.some((f) => f.topic === topic)) continue;
    const mine = input.modelUnknowns.find((u) => u.topic === topic);
    unknowns.push({
      topic,
      statement: mine?.statement ?? `No fetched source states the ${TOPIC_LABEL[topic]}.`,
    });
  }
  for (const u of input.modelUnknowns) {
    if (!(PROTECTED_RESEARCH_TOPICS as readonly string[]).includes(u.topic)) unknowns.push(u);
  }
  const summary = {
    facts: facts.map((f) => ({
      key: f.id,
      statement: f.statement,
      sourceFetchId: f.sourceFetchId!,
      ...(f.supportingText ? { supportingText: f.supportingText } : {}),
      topic: f.topic as AccountResearchSummary["facts"][number]["topic"],
      carriedOver: f.carriedOver,
    })),
    inferences: input.findings
      .filter((f) => f.kind === "inference" && f.basisIds.length > 0)
      .map((f) => ({
        key: f.id,
        statement: f.statement,
        basisKeys: f.basisIds,
        extractionConfidence: f.confidence,
      })),
    unknowns,
    contradictions: input.findings
      .filter((f) => f.kind === "contradiction" && f.sourceFetchId && f.secondSourceFetchId)
      .map((f) => ({
        key: f.id,
        statement: f.statement,
        sourceFetchIds: [f.sourceFetchId!, f.secondSourceFetchId!] as [string, string],
      })),
    sources: input.sources.map((s) => ({ fetchId: s.fetchId, flagged: s.flagged })),
  };
  return AccountResearchSummarySchema.parse(summary);
}
