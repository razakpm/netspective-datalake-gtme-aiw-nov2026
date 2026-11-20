// Normalisation for the claim checker (research R-06): NFKC, hyphen and dash variants unified to "-",
// every space to one space and runs of spaces collapsed. Case is kept, because acronym rules are
// case-sensitive. Each output unit remembers the original range it came from, so reported positions
// point into the text as written.

export interface Normalised {
  text: string;
  /** Per output UTF-16 unit: where its source character starts in the original text. */
  start: number[];
  /** Per output UTF-16 unit: where its source character (or collapsed run) ends in the original text. */
  end: number[];
}

const DASH = /[‐-―−﹘﹣－]/u;
const SPACE = /\s/u;

export function normalise(input: string): Normalised {
  const out: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  let i = 0;
  while (i < input.length) {
    const len = (input.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
    const piece = input.slice(i, i + len).normalize("NFKC");
    for (const raw of piece) {
      const ch = DASH.test(raw) ? "-" : SPACE.test(raw) ? " " : raw;
      if (ch === " " && out.length > 0 && out[out.length - 1] === " ") {
        end[end.length - 1] = i + len;
        continue;
      }
      for (const unit of ch) {
        for (let k = 0; k < unit.length; k++) {
          out.push(unit[k] as string);
          start.push(i);
          end.push(i + len);
        }
      }
    }
    i += len;
  }
  return { text: out.join(""), start, end };
}

/** The original range covered by normalised units [from, to). */
export function toOriginalRange(
  n: Normalised,
  from: number,
  to: number,
): { start: number; end: number } {
  if (to <= from) {
    const at = n.end[from - 1] ?? 0;
    return { start: at, end: at };
  }
  return { start: n.start[from] as number, end: n.end[to - 1] as number };
}

/** The form used to compare whole sentences: lower case, trimmed, no trailing sentence punctuation. */
export function normaliseForCompare(sentence: string): string {
  return normalise(sentence)
    .text.toLowerCase()
    .trim()
    .replace(/[.!?]+$/u, "");
}
