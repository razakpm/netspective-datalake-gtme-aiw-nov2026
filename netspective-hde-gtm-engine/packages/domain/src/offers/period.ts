// Capacity periods (feature 005, FR-017): calendar weeks (Monday to Sunday) and calendar months in one
// configured business time zone. A period is [start, end) in local dates; `end` is exclusive.

export type PeriodKind = "week" | "month";
export interface Period {
  kind: PeriodKind;
  start: string;
  end: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The calendar date of an instant in a time zone; throws RangeError for an unknown zone. */
export function localDateOf(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseLocalDate(date: string): number {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`not a calendar date: ${date}`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (iso(ms) !== date) throw new RangeError(`not a calendar date: ${date}`);
  return ms;
}

export function periodForLocalDate(date: string, kind: PeriodKind): Period {
  const ms = parseLocalDate(date);
  if (kind === "week") {
    const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
    const start = ms - sinceMonday * DAY_MS;
    return { kind, start: iso(start), end: iso(start + 7 * DAY_MS) };
  }
  const d = new Date(ms);
  return {
    kind,
    start: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
    end: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)),
  };
}

export const periodFor = (at: Date, kind: PeriodKind, timeZone: string): Period =>
  periodForLocalDate(localDateOf(at, timeZone), kind);
