// Budget rules in integer micro-units (feature 004, research R-03). No floating point: a cap is a cap.
// Before every model call the gateway asks `canAfford` with the WORST-CASE cost; a call that cannot be
// afforded is not made.

export const MICROS_PER_UNIT = 1_000_000;

export interface Rate {
  inMicrosPer1k: number;
  outMicrosPer1k: number;
}

/** "2.00" → 2_000_000. Null when the text is not a decimal amount with at most 6 decimals. */
export function parseMicros(amount: string): number | null {
  const m = /^([0-9]{1,9})(?:\.([0-9]{1,6}))?$/.exec(amount);
  if (!m) return null;
  return Number(m[1]) * MICROS_PER_UNIT + Number((m[2] ?? "").padEnd(6, "0"));
}

/** 200_000 → "0.20" (at least two decimals, no trailing zeros beyond that). */
export function formatMicros(micros: number): string {
  const whole = Math.floor(micros / MICROS_PER_UNIT);
  let frac = String(micros % MICROS_PER_UNIT)
    .padStart(6, "0")
    .replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${whole}.${frac}`;
}

export const estimateInputTokens = (characters: number): number => Math.ceil(characters / 4);

const price = (tokens: number, microsPer1k: number): number =>
  Math.ceil((tokens * microsPer1k) / 1000);

export function worstCaseCost(input: {
  inputTokens: number;
  maxOutputTokens: number;
  rate: Rate;
}): number {
  return (
    price(input.inputTokens, input.rate.inMicrosPer1k) +
    price(input.maxOutputTokens, input.rate.outMicrosPer1k)
  );
}

export function actualCost(input: {
  inputTokens: number;
  outputTokens: number;
  rate: Rate;
}): number {
  return (
    price(input.inputTokens, input.rate.inMicrosPer1k) +
    price(input.outputTokens, input.rate.outMicrosPer1k)
  );
}

export const remainingRunBudget = (maxCostMicros: number, spentMicros: number): number =>
  Math.max(0, maxCostMicros - spentMicros);

/** Allowance left for the account this calendar month: cap − spend so far − what active runs reserved. */
export const remainingAccountAllowance = (
  capMicros: number,
  spentMicros: number,
  reservedMicros: number,
): number => Math.max(0, capMicros - spentMicros - reservedMicros);

export function canAfford(input: {
  remainingRun: number;
  remainingAccount: number;
  worstCase: number;
}): boolean {
  return input.worstCase <= Math.min(input.remainingRun, input.remainingAccount);
}

export function validateRunBudget(
  budget: { maxSources: number; maxCostMicros: number },
  limits: { maxSourcesHard: number; runCapMicros: number },
): string[] {
  const out: string[] = [];
  if (!Number.isInteger(budget.maxSources) || budget.maxSources < 1)
    out.push("max_sources_invalid");
  else if (budget.maxSources > limits.maxSourcesHard) out.push("max_sources_above_limit");
  if (!Number.isInteger(budget.maxCostMicros) || budget.maxCostMicros < 1)
    out.push("max_cost_invalid");
  else if (budget.maxCostMicros > limits.runCapMicros) out.push("max_cost_above_run_cap");
  return out;
}
