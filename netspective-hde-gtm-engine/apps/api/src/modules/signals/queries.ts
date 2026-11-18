import type { Tx } from "@gtm/db";
import {
  externalUseAnswer,
  isCurrentEvidence,
  isStale,
  RELIABILITY_DEFINITIONS,
  CONFIDENCE_DEFINITIONS,
} from "@gtm/domain";
import { HttpError } from "../../http/errors.js";
import { resolveAccountScope, getSignal, type SignalRow } from "./repository.js";

// Signal read models: detail, the Signal Feed, the account timeline and "current evidence"
// (tasks T026, T036, T043, T050; spec FR-007, FR-028, FR-029, FR-033). Account-scoped reads resolve the
// account to its survivor and include accounts merged into it, because a signal keeps its original
// account id (spec edge case "Account merged into another").

const REMOVED = "[removed by retention policy]";

interface JoinedRow extends SignalRow {
  category: string;
  source_name: string;
  source_unavailable_since: string | null;
  type_status_label: string;
}

const BASE = `
  SELECT s.*, st.category AS category, st.status_label AS type_status_label,
         src.name AS source_name, src.unavailable_since AS source_unavailable_since
  FROM signal s
  JOIN signal_type st ON st.taxonomy_version = s.taxonomy_version AND st.key = s.type_key
  JOIN signal_source src ON src.id = s.source_id`;

export interface SignalSummary {
  id: string;
  accountId: string;
  contactId: string | null;
  typeKey: string;
  category: string;
  taxonomyVersion: number;
  observation: string;
  excerpt: string | null;
  excerptWithheldReason: string;
  source: { id: string; name: string; ref: string; unavailableSince: string | null };
  observedAt: string;
  collectedAt: string;
  publishedAt: string | null;
  reliability: string;
  extractionConfidence: string;
  evidenceStatus: string;
  reviewStatus: string;
  isCurrent: boolean;
  stale: boolean;
  undated: boolean;
  freshUntil: string;
  flags: { newProvenanceSinceReview: boolean; reverifyRequired: boolean; contextOnly: boolean };
  fundingClass: string;
  regulatoryStatus: string | null;
  statusLabel: string;
}

function summarise(row: JoinedRow, now: Date): SignalSummary {
  // Retention is applied lazily here, so correctness never depends on the scheduled job (R-11).
  const expired = row.purged_at !== null || Date.parse(row.retain_until) <= now.getTime();
  return {
    id: row.id,
    accountId: row.account_id,
    contactId: row.contact_id,
    typeKey: row.type_key,
    category: row.category,
    taxonomyVersion: row.taxonomy_version,
    observation: expired ? REMOVED : row.observation,
    excerpt: expired ? null : row.excerpt,
    excerptWithheldReason: row.excerpt_withheld_reason,
    source: {
      id: row.source_id,
      name: row.source_name,
      ref: row.source_ref,
      unavailableSince: row.source_unavailable_since,
    },
    observedAt: row.observed_at,
    collectedAt: row.collected_at,
    publishedAt: row.published_at,
    reliability: row.reliability,
    extractionConfidence: row.extraction_confidence,
    evidenceStatus: row.evidence_status,
    reviewStatus: row.review_status,
    isCurrent: isCurrentEvidence(
      { reviewStatus: row.review_status, freshUntil: row.fresh_until, purged: expired },
      now,
    ),
    stale: isStale(row.fresh_until, now),
    undated: row.undated === 1,
    freshUntil: row.fresh_until,
    flags: {
      newProvenanceSinceReview: row.new_provenance_flag === 1,
      reverifyRequired: row.reverify_required === 1,
      contextOnly: row.context_only === 1,
    },
    fundingClass: row.funding_class,
    regulatoryStatus: row.regulatory_status,
    statusLabel: row.type_status_label,
  };
}

export interface SignalDetail extends SignalSummary {
  aiModel: string | null;
  aiPromptVersion: string | null;
  extractionMethod: string;
  provenance: {
    seq: number;
    kind: string;
    actorType: string;
    actorId: string | null;
    method: string | null;
    sourceId: string | null;
    sourceRef: string | null;
    occurredAt: string;
    detail: Record<string, unknown>;
  }[];
  supporting: { entityType: string; entityId: string }[];
  contradictory: { entityType: string; entityId: string }[];
  reviews: {
    decision: string;
    reason: string | null;
    contradictsSignalId: string | null;
    reliabilitySet: string | null;
    decidedBy: string;
    decidedAt: string;
  }[];
  relevance: { icp: string[]; capability: string[]; offer: string[] };
  retention: { policy: string; retainUntil: string };
  sensitivity: string;
  approvalCitation: string | null;
  regulatoryItem: string | null;
  externalUse: string;
  definitions: {
    reliability: typeof RELIABILITY_DEFINITIONS;
    confidence: typeof CONFIDENCE_DEFINITIONS;
  };
}

function loadJoined(tx: Tx, id: string): JoinedRow | undefined {
  return tx.prepare(`${BASE} WHERE s.id = ?`).get(id) as JoinedRow | undefined;
}

export function getSignalDetail(tx: Tx, id: string, now: Date): SignalDetail {
  const row = loadJoined(tx, id);
  if (!row) throw new HttpError(404, "Not found", "No such signal");
  const summary = summarise(row, now);
  const links = tx
    .prepare(
      "SELECT entity_type, entity_id, role FROM signal_link WHERE signal_id = ? ORDER BY linked_at, id",
    )
    .all(id) as { entity_type: string; entity_id: string; role: string }[];
  const tags = tx
    .prepare("SELECT dimension, value FROM signal_tag WHERE signal_id = ? ORDER BY value")
    .all(id) as { dimension: string; value: string }[];
  const provenance = (
    tx.prepare("SELECT * FROM signal_provenance WHERE signal_id = ? ORDER BY seq").all(id) as {
      seq: number;
      kind: string;
      actor_type: string;
      actor_id: string | null;
      method: string | null;
      source_id: string | null;
      source_ref: string | null;
      occurred_at: string;
      detail: string;
    }[]
  ).map((p) => ({
    seq: p.seq,
    kind: p.kind,
    actorType: p.actor_type,
    actorId: p.actor_id,
    method: p.method,
    sourceId: p.source_id,
    sourceRef: p.source_ref,
    occurredAt: p.occurred_at,
    detail: JSON.parse(p.detail) as Record<string, unknown>,
  }));
  const reviews = (
    tx
      .prepare("SELECT * FROM signal_review WHERE signal_id = ? ORDER BY decided_at, id")
      .all(id) as {
      decision: string;
      reason: string | null;
      contradicts_signal_id: string | null;
      reliability_set: string | null;
      decided_by: string;
      decided_at: string;
    }[]
  ).map((r) => ({
    decision: r.decision,
    reason: r.reason,
    contradictsSignalId: r.contradicts_signal_id,
    reliabilitySet: r.reliability_set,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
  }));
  const of = (role: string) =>
    links
      .filter((l) => l.role === role)
      .map((l) => ({ entityType: l.entity_type, entityId: l.entity_id }));
  const tag = (d: string) => tags.filter((t) => t.dimension === d).map((t) => t.value);
  return {
    ...summary,
    aiModel: row.ai_model,
    aiPromptVersion: row.ai_prompt_version,
    extractionMethod: row.extraction_method,
    provenance,
    supporting: of("supporting"),
    contradictory: of("contradictory"),
    reviews,
    relevance: { icp: tag("icp"), capability: tag("capability"), offer: tag("offer") },
    retention: { policy: row.retention_policy, retainUntil: row.retain_until },
    sensitivity: row.sensitivity,
    approvalCitation: row.approval_citation,
    regulatoryItem: row.regulatory_item,
    externalUse: externalUseAnswer({
      contextOnly: row.context_only === 1,
      reverifyRequired: row.reverify_required === 1,
    }),
    definitions: { reliability: RELIABILITY_DEFINITIONS, confidence: CONFIDENCE_DEFINITIONS },
  };
}

export interface FeedFilters {
  type?: string | undefined;
  category?: string | undefined;
  icp?: string | undefined;
  accountId?: string | undefined;
  sourceId?: string | undefined;
  capability?: string | undefined;
  offer?: string | undefined;
  confidence?: string | undefined;
  freshness?: "fresh" | "stale" | "undated" | undefined;
  reviewStatus?: string | undefined;
  currentOnly?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export function listSignals(
  tx: Tx,
  filters: FeedFilters,
  now: Date,
): { items: SignalSummary[]; nextCursor: string | null } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.type) {
    where.push("s.type_key = ?");
    params.push(filters.type);
  }
  if (filters.category) {
    where.push("st.category = ?");
    params.push(filters.category);
  }
  if (filters.accountId) {
    const scope = resolveAccountScope(tx, filters.accountId);
    if (!scope) throw new HttpError(404, "Not found", "No such account");
    where.push(`s.account_id IN (${scope.ids.map(() => "?").join(",")})`);
    params.push(...scope.ids);
  }
  if (filters.sourceId) {
    where.push("s.source_id = ?");
    params.push(filters.sourceId);
  }
  if (filters.confidence) {
    where.push("s.extraction_confidence = ?");
    params.push(filters.confidence);
  }
  if (filters.reviewStatus) {
    where.push("s.review_status = ?");
    params.push(filters.reviewStatus);
  }
  for (const [dimension, value] of [
    ["icp", filters.icp],
    ["capability", filters.capability],
    ["offer", filters.offer],
  ] as const) {
    if (value) {
      where.push(
        "EXISTS (SELECT 1 FROM signal_tag t WHERE t.signal_id = s.id AND t.dimension = ? AND t.value = ?)",
      );
      params.push(dimension, value);
    }
  }
  const nowIso = now.toISOString();
  if (filters.freshness === "fresh") {
    where.push("s.fresh_until > ?");
    params.push(nowIso);
  } else if (filters.freshness === "stale") {
    where.push("s.fresh_until <= ?");
    params.push(nowIso);
  } else if (filters.freshness === "undated") {
    where.push("s.undated = 1");
  }
  if (filters.currentOnly) {
    where.push(
      "s.review_status = 'approved' AND s.purged_at IS NULL AND s.fresh_until > ? AND s.retain_until > ?",
    );
    params.push(nowIso, nowIso);
  }
  if (filters.cursor) {
    where.push("s.id < ?");
    params.push(filters.cursor);
  }
  const limit = filters.limit ?? 50;
  const rows = tx
    .prepare(
      `${BASE} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.id DESC LIMIT ?`,
    )
    .all(...params, limit + 1) as unknown as JoinedRow[];
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => summarise(r, now)),
    nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
  };
}

/** The account timeline (signals of the survivor and of accounts merged into it), newest first. */
export function listAccountSignals(
  tx: Tx,
  accountId: string,
  opts: {
    currentOnly?: boolean | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
  now: Date,
) {
  return listSignals(tx, { accountId, ...opts }, now);
}

/** Current evidence: approved, within the freshness window, not purged. Pending signals never count. */
export function currentEvidence(tx: Tx, accountId: string, now: Date): SignalSummary[] {
  return listSignals(tx, { accountId, currentOnly: true, limit: 200 }, now).items;
}

export function signalExists(tx: Tx, id: string): boolean {
  return getSignal(tx, id) !== undefined;
}
