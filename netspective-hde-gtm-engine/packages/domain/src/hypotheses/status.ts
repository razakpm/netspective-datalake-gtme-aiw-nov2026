// The hypothesis status machine (feature 004, spec FR-027 to FR-032, research R-11). Pure. Only a human
// reviewer changes status, with a note, along an allowed transition; `validated` needs a supporting signal
// that is approved and buyer-confirmed; `stale` is set only by the staleness rule (the system actor).

export const HYPOTHESIS_STATUSES = [
  "untested",
  "strengthening",
  "weakening",
  "validated",
  "rejected",
  "stale",
] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

const HUMAN_TRANSITIONS: Readonly<Record<HypothesisStatus, readonly HypothesisStatus[]>> = {
  untested: ["strengthening", "weakening", "rejected", "validated"],
  strengthening: ["weakening", "rejected", "validated"],
  weakening: ["strengthening", "rejected", "validated"],
  validated: ["weakening", "rejected"],
  rejected: ["untested"],
  stale: ["untested", "strengthening", "weakening"],
};
const SYSTEM_TO_STALE: readonly HypothesisStatus[] = ["untested", "strengthening", "weakening"];

export type StatusChange = { ok: true } | { ok: false; code: string };

export function evaluateStatusChange(input: {
  from: HypothesisStatus;
  to: HypothesisStatus;
  note: string;
  actor: { kind: "human" | "ai" | "system" };
  hasValidatingEvidence: boolean;
}): StatusChange {
  if (input.actor.kind === "system") {
    if (input.to === "stale" && SYSTEM_TO_STALE.includes(input.from)) return { ok: true };
    return { ok: false, code: "reviewer_must_be_human" };
  }
  if (input.actor.kind !== "human") return { ok: false, code: "reviewer_must_be_human" };
  if (input.note.trim().length < 3) return { ok: false, code: "note_required" };
  if (!HUMAN_TRANSITIONS[input.from].includes(input.to))
    return { ok: false, code: "transition_not_allowed" };
  if (input.to === "validated" && !input.hasValidatingEvidence) {
    return { ok: false, code: "validated_needs_buyer_confirmed_evidence" };
  }
  return { ok: true };
}
