import type { OrgType } from "./org-types.js";
import { normaliseName } from "./normalise.js";
import { DEFAULT_SIMILARITY_THRESHOLD, nameSimilarity } from "./similarity.js";

// Duplicate candidate detection (spec FR-004, FR-008, clarified 2026-11-16). Pure rules; the output only
// proposes candidates for human review. Nothing here merges anything (FR-005).

export interface MatchAccount {
  id: string;
  name: string;
  /** Current and former names. */
  aliases: readonly string[];
  domains: readonly { domain: string; shared: boolean }[];
  orgType: OrgType;
  geography: string | null;
}

export type CandidateReason = "domain_match" | "alias_match" | "name_similarity";

export interface Candidate {
  matchedId: string;
  reasons: CandidateReason[];
  score: number;
}

export interface ResolveOptions {
  threshold?: number;
}

function sameGeography(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Type or geography must also match for a name-based candidate (the clarified gate). */
function contextMatches(a: MatchAccount, b: MatchAccount): boolean {
  const sameType = a.orgType === b.orgType && a.orgType !== "unknown";
  return sameType || sameGeography(a.geography, b.geography);
}

export function detectCandidates(
  incoming: MatchAccount,
  existing: readonly MatchAccount[],
  options: ResolveOptions = {},
): Candidate[] {
  const threshold = options.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const incomingNames = [incoming.name, ...incoming.aliases];
  const out: Candidate[] = [];

  for (const other of existing) {
    if (other.id === incoming.id) continue;
    const reasons: CandidateReason[] = [];
    let score = 0;

    // Exact domain match always proposes a candidate unless the domain is shared (FR-008).
    const shared = incoming.domains.some((d) =>
      other.domains.some((o) => o.domain === d.domain && !d.shared && !o.shared),
    );
    if (shared) {
      reasons.push("domain_match");
      score = 1;
    }

    // Name or alias similarity proposes a candidate only with a matching type or geography.
    if (contextMatches(incoming, other)) {
      const otherNames = [other.name, ...other.aliases];
      let best = 0;
      let exact = false;
      for (const a of incomingNames) {
        for (const b of otherNames) {
          if (normaliseName(a) !== "" && normaliseName(a) === normaliseName(b)) exact = true;
          best = Math.max(best, nameSimilarity(a, b));
        }
      }
      if (exact) {
        reasons.push("alias_match");
        score = Math.max(score, best);
      } else if (best >= threshold) {
        reasons.push("name_similarity");
        score = Math.max(score, best);
      }
    }

    if (reasons.length > 0) out.push({ matchedId: other.id, reasons, score });
  }
  return out.sort((a, b) => b.score - a.score || (a.matchedId < b.matchedId ? -1 : 1));
}
