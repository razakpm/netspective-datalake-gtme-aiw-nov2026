// Research settings read from configuration (feature 004). Amounts are integer micro-units.
export interface ResearchSettings {
  maxSources: number;
  maxSourcesHard: number;
  runCapMicros: number;
  accountMonthlyCapMicros: number;
  maxRetries: number;
  interpretationCapMicros: number;
  fetchTimeoutMs: number;
  maxPageBytes: number;
  hypothesisStaleDays: number;
}

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  maxSources: 10,
  maxSourcesHard: 25,
  runCapMicros: 2_000_000,
  accountMonthlyCapMicros: 20_000_000,
  maxRetries: 2,
  interpretationCapMicros: 200_000,
  fetchTimeoutMs: 10_000,
  maxPageBytes: 1_048_576,
  hypothesisStaleDays: 90,
};

export interface ResearchActor {
  userId: string | null;
  actorType: "human" | "ai" | "system";
  correlationId: string | null;
  now?: (() => Date) | undefined;
}

/** First instant of the calendar month (UTC) containing `now`. */
export function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
