import type { VerifiedFinding } from "@gtm/domain";
import type { SignalService } from "../signals/index.js";

// Signal hand-off to feature 003 (task T034; spec FR-013 to FR-015). Kept facts become `derived_interpretation`
// and kept inferences `ai_hypothesis` signals through feature 003's ingest path with an AI actor: always
// unreviewed, never observed or buyer-confirmed, never an approval. Duplicates merge per feature 003.

export interface HandoffSource {
  address: string;
  host: string;
  signalSourceKind: string;
}

export interface HandoffOutcome {
  key: string;
  signalId: string | null;
  created: boolean;
  refusalCodes: string[];
}

export function handOffSignals(
  signals: SignalService,
  ctx: {
    accountId: string;
    model: string;
    promptVersion: string;
    correlationId: string | null;
    now: () => Date;
    sourceFor: (fetchId: string) => HandoffSource | undefined;
    firstFetchOf: (finding: VerifiedFinding, byKey: Map<string, VerifiedFinding>) => string | null;
  },
  kept: readonly VerifiedFinding[],
): HandoffOutcome[] {
  const byKey = new Map(kept.map((k) => [k.key, k]));
  const out: HandoffOutcome[] = [];
  for (const f of kept) {
    if ((f.kind !== "fact" && f.kind !== "inference") || f.typeKey === null) continue;
    const fetchId = ctx.firstFetchOf(f, byKey);
    const source = fetchId ? ctx.sourceFor(fetchId) : undefined;
    if (!source) continue;
    const actor = {
      userId: null,
      actorType: "ai" as const,
      correlationId: ctx.correlationId,
      now: ctx.now,
    };
    try {
      const r = signals.ingestSubmission(actor, {
        accountId: ctx.accountId,
        typeKey: f.typeKey,
        observation: f.statement,
        observedAt: ctx.now().toISOString(),
        source: {
          name: `Research: ${source.host}`,
          kind: source.signalSourceKind,
          ref: source.address,
        },
        extractionMethod: "ai_extracted",
        extractionConfidence: f.confidence,
        evidenceStatus: f.kind === "fact" ? "derived_interpretation" : "ai_hypothesis",
        aiModel: ctx.model,
        aiPromptVersion: ctx.promptVersion,
      });
      out.push({
        key: f.key,
        signalId: r.signal.id,
        created: r.outcome === "created",
        refusalCodes: [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "refused";
      const codes = message
        .replace(/^Refused: /, "")
        .split(", ")
        .filter(Boolean)
        .slice(0, 5);
      out.push({
        key: f.key,
        signalId: null,
        created: false,
        refusalCodes: codes.length ? codes : ["refused"],
      });
    }
  }
  return out;
}
