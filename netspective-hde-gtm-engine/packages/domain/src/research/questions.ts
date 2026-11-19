// Discovery-question and capability-match rules for the problem interpreter (feature 004, spec FR-033/FR-034,
// research R-14). Pure and deterministic. A question may ask about field names, source-system names, formats
// and timelines only; it must never ask for patient-level data, values, records, rows or samples.

const PATIENT_LEVEL: RegExp[] = [
  /\bpatients?\b[^.?]*\b(names?|data|records?|ids?|identifiers?|details)\b/i,
  /\b(MRN|SSN|medical record number|social security|date of birth|DOB)\b/i,
  /\bsamples?\b/i,
  /\brows?\b/i,
  /\brecords?\b/i,
  /\b(real|actual|live)\s+values?\b/i,
  /\b(send|share|email|upload|attach)\b[^.?]*\b(file|extract|export|dump|data)\b/i,
];

export type QuestionCheck = { ok: true } | { ok: false; code: string };

export function checkDiscoveryQuestion(question: string): QuestionCheck {
  for (const p of PATIENT_LEVEL)
    if (p.test(question)) return { ok: false, code: "asks_for_patient_level_data" };
  return { ok: true };
}

export interface RawMatch {
  capabilityKey: string;
  band: "low" | "medium" | "high";
  reason: string;
}

const RANK = { low: 0, medium: 1, high: 2 } as const;

export function sanitizeInterpretation(input: {
  matches: readonly RawMatch[];
  discoveryQuestions: readonly string[];
  allowedCapabilityKeys: ReadonlySet<string>;
}): {
  matches: RawMatch[];
  discoveryQuestions: string[];
  dropped: { matches: number; questions: number };
} {
  const best = new Map<string, RawMatch>();
  let droppedMatches = 0;
  for (const m of input.matches) {
    if (!input.allowedCapabilityKeys.has(m.capabilityKey)) {
      droppedMatches += 1;
      continue;
    }
    const cur = best.get(m.capabilityKey);
    if (!cur || RANK[m.band] > RANK[cur.band]) best.set(m.capabilityKey, m);
  }
  const questions = input.discoveryQuestions.filter((q) => checkDiscoveryQuestion(q).ok);
  const matches = [...best.values()].sort(
    (a, b) => RANK[b.band] - RANK[a.band] || a.capabilityKey.localeCompare(b.capabilityKey),
  );
  return {
    matches,
    discoveryQuestions: questions,
    dropped: {
      matches: droppedMatches,
      questions: input.discoveryQuestions.length - questions.length,
    },
  };
}
