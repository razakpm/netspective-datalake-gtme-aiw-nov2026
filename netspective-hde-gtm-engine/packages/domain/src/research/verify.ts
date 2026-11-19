import { createHash } from "node:crypto";

// Deterministic verification of the model's findings (feature 004, research R-07, spec FR-011/FR-012). The
// model is never trusted: every finding must cite a source the run actually read, and a fact must quote
// text that occurs in that source. On the five protected topics only a verified fact survives; any
// protected topic without one becomes an unknown. Pure and deterministic.

export const PROTECTED_RESEARCH_TOPICS = [
  "data_architecture",
  "source_systems",
  "budget",
  "project_status",
  "buying_authority",
] as const;
type Protected = (typeof PROTECTED_RESEARCH_TOPICS)[number];
const PROTECTED = new Set<string>(PROTECTED_RESEARCH_TOPICS);

const TOPIC_LABEL: Record<Protected, string> = {
  data_architecture: "data architecture",
  source_systems: "source systems",
  budget: "budget",
  project_status: "project status",
  buying_authority: "buying authority",
};

export type Band = "low" | "medium" | "high";

export interface VerifiableFinding {
  key: string;
  kind: "fact" | "inference" | "unknown" | "contradiction";
  topic: string;
  statement: string;
  supportingText?: string | undefined;
  sourceFetchId?: string | undefined;
  secondSourceFetchId?: string | undefined;
  basisKeys?: string[] | undefined;
  typeKey?: string | undefined;
  extractionConfidence: Band;
}

export interface VerifierSource {
  fetchId: string;
  address: string;
  text: string;
  /** True when the run read this source and sent it onward (not skipped, refused or blocked). */
  read: boolean;
}

export interface VerifiedFinding {
  key: string;
  kind: VerifiableFinding["kind"];
  topic: string;
  statement: string;
  supportingText: string | null;
  supportingTextSha256: string | null;
  sourceFetchId: string | null;
  secondSourceFetchId: string | null;
  basisKeys: string[];
  typeKey: string | null;
  confidence: Band;
  verified: boolean;
}

export interface VerifyResult {
  kept: VerifiedFinding[];
  unknowns: { topic: string; statement: string }[];
  dropped: { uncited: number; unsupported: number; protectedTopic: number; taxonomy: number };
  entityMatch: Record<string, Band>;
}

export function normaliseForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const rank: Record<Band, number> = { low: 0, medium: 1, high: 2 };
const cap = (a: Band, b: Band): Band => (rank[a] <= rank[b] ? a : b);

export function verifyFindings(input: {
  findings: readonly VerifiableFinding[];
  sources: readonly VerifierSource[];
  allowedTypeKeys: ReadonlySet<string>;
  account: { name: string; domains: readonly string[] };
}): VerifyResult {
  const sources = new Map(input.sources.map((s) => [s.fetchId, s]));
  const normText = new Map(input.sources.map((s) => [s.fetchId, normaliseForQuote(s.text)]));
  const name = normaliseForQuote(input.account.name);
  const entityMatch: Record<string, Band> = {};
  for (const s of input.sources) {
    const text = normText.get(s.fetchId)!;
    const host = (() => {
      try {
        return new URL(s.address).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    const named = name !== "" && text.includes(name);
    const domain = input.account.domains.some(
      (d) => host === d || host.endsWith(`.${d}`) || text.includes(normaliseForQuote(d)),
    );
    entityMatch[s.fetchId] = s.read && (named || domain) ? "high" : "low";
  }

  const dropped = { uncited: 0, unsupported: 0, protectedTopic: 0, taxonomy: 0 };
  const kept: VerifiedFinding[] = [];
  const keptKeys = new Set<string>();
  const seenKeys = new Set<string>();
  const modelUnknowns: { topic: string; statement: string }[] = [];

  const readable = (id: string | undefined) =>
    id !== undefined && sources.get(id)?.read === true ? id : null;

  const consider = (f: VerifiableFinding) => {
    if (seenKeys.has(f.key)) {
      dropped.unsupported += 1;
      return;
    }
    seenKeys.add(f.key);
    if (f.kind === "unknown") {
      modelUnknowns.push({ topic: f.topic, statement: f.statement });
      return;
    }
    if (f.typeKey !== undefined && !input.allowedTypeKeys.has(f.typeKey)) {
      dropped.taxonomy += 1;
      return;
    }
    const isProtected = PROTECTED.has(f.topic);
    if (f.kind !== "fact" && isProtected) {
      dropped.protectedTopic += 1;
      return;
    }
    let first: string | null = null;
    let second: string | null = null;
    if (f.kind === "fact" || f.kind === "contradiction") {
      first = readable(f.sourceFetchId);
      if (first === null) {
        dropped.uncited += 1;
        return;
      }
    }
    if (f.kind === "contradiction") {
      second = readable(f.secondSourceFetchId);
      if (second === null) {
        dropped.uncited += 1;
        return;
      }
      if (second === first) {
        dropped.unsupported += 1;
        return;
      }
    }
    if (f.kind === "inference") {
      first = f.sourceFetchId !== undefined ? readable(f.sourceFetchId) : null;
      if (f.sourceFetchId !== undefined && first === null) {
        dropped.uncited += 1;
        return;
      }
      const basis = f.basisKeys ?? [];
      if (basis.length === 0 || !basis.every((k) => keptKeys.has(k))) {
        dropped.unsupported += 1;
        return;
      }
    }
    let quote: string | null = null;
    let quoteHash: string | null = null;
    if (f.supportingText !== undefined && first !== null) {
      const q = normaliseForQuote(f.supportingText);
      if (q === "" || !normText.get(first)!.includes(q)) {
        dropped.unsupported += 1;
        return;
      }
      quote = f.supportingText;
      quoteHash = sha(q);
    } else if (f.kind === "fact") {
      dropped.unsupported += 1;
      return;
    }
    const basedOn = first ?? undefined;
    const confidence = basedOn
      ? cap(f.extractionConfidence, entityMatch[basedOn] ?? "low")
      : f.extractionConfidence;
    kept.push({
      key: f.key,
      kind: f.kind,
      topic: f.topic,
      statement: f.statement,
      supportingText: quote,
      supportingTextSha256: quoteHash,
      sourceFetchId: first,
      secondSourceFetchId: second,
      basisKeys: f.basisKeys ?? [],
      typeKey: f.typeKey ?? null,
      confidence,
      verified: f.kind === "fact" || f.kind === "contradiction" || quoteHash !== null,
    });
    keptKeys.add(f.key);
  };

  // Facts, contradictions and unknowns first, so inferences can rest on what was kept.
  for (const f of input.findings) if (f.kind !== "inference") consider(f);
  for (const f of input.findings) if (f.kind === "inference") consider(f);

  const unknowns: { topic: string; statement: string }[] = [];
  for (const topic of PROTECTED_RESEARCH_TOPICS) {
    if (kept.some((k) => k.kind === "fact" && k.topic === topic)) continue;
    const mine = modelUnknowns.find((u) => u.topic === topic);
    unknowns.push({
      topic,
      statement: mine?.statement ?? `No fetched source states the ${TOPIC_LABEL[topic]}.`,
    });
  }
  for (const u of modelUnknowns) {
    if (
      !PROTECTED.has(u.topic) &&
      !unknowns.some((x) => x.topic === u.topic && x.statement === u.statement)
    )
      unknowns.push(u);
  }
  return { kept, unknowns, dropped, entityMatch };
}
