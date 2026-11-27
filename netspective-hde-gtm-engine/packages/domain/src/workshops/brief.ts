import type { FindingsKind } from "./findings.js";

// The preparation brief (feature 007, spec FR-010 to FR-013, research R-08; constitution I and II). Pure.
// A baseline is built from the recorded evidence with no model; a model's answer may only improve it. A
// confirmed fact is always the evidence record's own text, chosen by identifier; anything else is an
// inference that cites evidence; contradicting evidence is always listed. The questions and the artifact
// checklist are hypotheses (open question #53).

export interface BriefEvidence {
  id: string;
  topic: string;
  status:
    | "observed"
    | "buyer_confirmed"
    | "derived_interpretation"
    | "ai_hypothesis"
    | "unverified_assumption"
    | "contradictory";
  text: string;
}

export interface BriefContent {
  entityIds: { workshopId: string; accountId: string };
  confirmedFacts: { evidenceId: string; text: string }[];
  inferences: {
    statement: string;
    evidenceIds: string[];
    contradictingEvidenceIds: string[];
    basis: string;
  }[];
  contradictions: { evidenceId: string; text: string }[];
  unknowns: string[];
  suggestedQuestions: string[];
  artifactChecklist: { kind: string; why: string }[];
}

/** The shape of a model's answer that this module checks (the AI contract validates it first). */
export interface BriefModelAnswer {
  entityIds: { workshopId: string; accountId: string };
  confirmedFactIds: string[];
  inferences: BriefContent["inferences"];
  unknowns: string[];
  suggestedQuestions: string[];
  artifactChecklist: { kind: string; why: string }[];
}

export interface BriefContext {
  workshopId: string;
  accountId: string;
  kind: FindingsKind;
  evidence: readonly BriefEvidence[];
  artifactKinds: readonly string[];
}

const CONFIRMING: ReadonlySet<BriefEvidence["status"]> = new Set(["observed", "buyer_confirmed"]);
const INFERRED: Partial<Record<BriefEvidence["status"], string>> = {
  derived_interpretation: "a derived interpretation",
  ai_hypothesis: "an AI hypothesis",
  unverified_assumption: "an unverified assumption",
};

const QUESTIONS: Record<FindingsKind, string[]> = {
  offer_1: [
    "Which stages does a new sender pass through, and who owns each one?",
    "Which sender was onboarded most recently, and how long did each stage take?",
    "Which rejections repeat, and who can change the rule behind them?",
    "Which format and implementation guide does the sender follow?",
    "What changes on the exchange side force the sender to rework?",
    "Which delays could not be measured, and why?",
  ],
  offer_6: [
    "Which single use case is the pilot meant to serve, and who owns it?",
    "For each field, which system and which message or interface does it come from?",
    "What is known about the quality, completeness and freshness of each field?",
    "Who can say where each field originates and how it is changed on the way?",
    "Who grants access to each source, and what does access depend on?",
    "Which of these things does nobody in the room know?",
  ],
};

const TOPICS: Record<FindingsKind, [topic: string, words: string][]> = {
  offer_1: [
    ["sender_onboarding_friction", "friction in onboarding senders"],
    ["ig_change_friction", "rework caused by implementation guide changes"],
  ],
  offer_6: [
    ["stalled_ai_pilot", "a pilot that has stalled"],
    ["demonstrated_data_problem", "a demonstrated problem with the data"],
  ],
};

const CHECKLIST: Record<FindingsKind, [kind: string, why: string][]> = {
  offer_1: [
    ["specification", "To read the format and implementation guide a sender follows."],
    ["timeline", "To see the stages of a recent onboarding and how long each took."],
    ["scrubbed_rejection_log", "To see which rejections repeat. Values must be removed."],
  ],
  offer_6: [
    ["field_list", "To confirm the names of the ten fields. Names only, no values."],
    ["interface_description", "To see which messages or interfaces carry the fields."],
    ["specification", "To read how each source defines the fields."],
  ],
};

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const contradictionsOf = (evidence: readonly BriefEvidence[]) =>
  evidence
    .filter((e) => e.status === "contradictory")
    .map((e) => ({ evidenceId: e.id, text: e.text }));

const confirmedOf = (e: BriefEvidence) => ({ evidenceId: e.id, text: e.text });

/** The brief made from the records alone. */
export function baselineBrief(context: BriefContext): BriefContent {
  const { evidence, kind } = context;
  const confirmed = evidence.filter((e) => CONFIRMING.has(e.status));
  const unknowns = TOPICS[kind]
    .filter(([topic]) => !confirmed.some((e) => e.topic === topic))
    .map(([, words]) => `No observed or buyer-confirmed evidence about ${words}.`);
  if (confirmed.length === 0 && unknowns.length === 0) {
    unknowns.push("No observed or buyer-confirmed evidence is held for this account.");
  }
  unknowns.push("Anything the intake and the records do not cover.");
  return {
    entityIds: { workshopId: context.workshopId, accountId: context.accountId },
    confirmedFacts: confirmed.map(confirmedOf),
    inferences: evidence
      .filter((e) => INFERRED[e.status] !== undefined)
      .map((e) => ({
        statement: clip(e.text, 300),
        evidenceIds: [e.id],
        contradictingEvidenceIds: evidence
          .filter((c) => c.status === "contradictory" && c.topic === e.topic)
          .map((c) => c.id),
        basis: `Recorded as ${INFERRED[e.status]}, not as an observation.`,
      })),
    contradictions: contradictionsOf(evidence),
    unknowns,
    suggestedQuestions: QUESTIONS[kind],
    artifactChecklist: CHECKLIST[kind]
      .filter(([k]) => context.artifactKinds.includes(k))
      .map(([k, why]) => ({ kind: k, why })),
  };
}

/**
 * Check a model's answer against the records. Facts are rebuilt from the evidence text; citations that do
 * not exist are removed and an inference left with none is dropped; contradictions come from the records.
 */
export function verifyBrief(
  answer: BriefModelAnswer,
  context: BriefContext,
): { ok: true; content: BriefContent } | { ok: false } {
  const { entityIds } = answer;
  if (entityIds.workshopId !== context.workshopId || entityIds.accountId !== context.accountId) {
    return { ok: false };
  }
  const known = new Map(context.evidence.map((e) => [e.id, e]));
  const chosen = new Set(answer.confirmedFactIds);
  return {
    ok: true,
    content: {
      entityIds,
      confirmedFacts: context.evidence
        .filter((e) => chosen.has(e.id) && CONFIRMING.has(e.status))
        .map(confirmedOf),
      inferences: answer.inferences
        .map((i) => ({
          ...i,
          evidenceIds: i.evidenceIds.filter((id) => known.has(id)),
          contradictingEvidenceIds: i.contradictingEvidenceIds.filter((id) => known.has(id)),
        }))
        .filter((i) => i.evidenceIds.length > 0),
      contradictions: contradictionsOf(context.evidence),
      unknowns: answer.unknowns,
      suggestedQuestions: answer.suggestedQuestions.slice(0, 12),
      artifactChecklist: answer.artifactChecklist.filter((a) =>
        context.artifactKinds.includes(a.kind),
      ),
    },
  };
}
