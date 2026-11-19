import { SignalSubmissionSchema } from "@gtm/ai-contracts";
import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  applyExcerptRule,
  applyRegulatoryRules,
  canonicaliseSourceRef,
  classifyFunding,
  contentFingerprint,
  decideDuplicate,
  deriveSensitivity,
  freshAnchor,
  freshUntil as computeFreshUntil,
  guardValue,
  isUndated,
  normaliseObservation,
  SOURCE_KIND_RELIABILITY,
  validateNewSignal,
  type DedupCandidate,
  type EvidenceStatus,
  type ExtractionConfidence,
  type ExtractionMethod,
  type FundingClass,
  type Reliability,
  type RegulatoryStatus,
  type SourceKind,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { runIdempotent, type IdempotentResult } from "../../http/idempotency.js";
import { recordAudit } from "../audit/index.js";
import { SignalRefusal, auditedRefusals, type SignalActor } from "./actor.js";
import { emitDiscovered } from "./events.js";
import { getSignalDetail, type SignalDetail } from "./queries.js";
import {
  appendProvenance,
  currentTaxonomyVersion,
  getSignal,
  getSource,
  getSourceByName,
  getType,
  resolveAccountScope,
  type SignalRow,
  type SourceRow,
} from "./repository.js";

// Recording signals, with validation, the PHI guard, excerpt limits, funding and regulatory rules and
// de-duplication (tasks T022 to T031, T047, T049). One transaction per submission: the signal, its
// provenance, the audit event and the outbox event commit together.

export interface SignalSettings {
  excerptMaxChars: number;
  similarityThreshold: number;
  retentionMonths: number;
}

export interface RecordInput {
  accountId: string;
  contactId?: string | undefined;
  typeKey: string;
  source: {
    sourceId?: string | undefined;
    name?: string | undefined;
    kind?: SourceKind | undefined;
    ref: string;
    itemKey?: string | undefined;
  };
  observation: string;
  excerpt?: string | undefined;
  observedAt: string;
  publishedAt?: string | undefined;
  /** Reviewer override of the source's default reliability. */
  reliability?: Reliability | undefined;
  extractionMethod?: ExtractionMethod | undefined;
  extractionConfidence?: ExtractionConfidence | undefined;
  aiModel?: string | undefined;
  aiPromptVersion?: string | undefined;
  evidenceStatus?: EvidenceStatus | undefined;
  relevance?:
    | {
        icp?: string[] | undefined;
        capability?: string[] | undefined;
        offer?: string[] | undefined;
      }
    | undefined;
  fundingClass?: Exclude<FundingClass, "none"> | undefined;
  approvalCitation?: string | undefined;
  regulatoryItem?: string | undefined;
  regulatoryStatus?: RegulatoryStatus | undefined;
  supports?: { entityType: string; entityId: string }[] | undefined;
  contradicts?: { entityType: string; entityId: string }[] | undefined;
}

export interface RecordResult {
  outcome: "created" | "already_exists" | "merged";
  mergeKind?: "merged_duplicate" | "republication";
  signal: SignalDetail;
}

const LINK_TYPES = new Set(["evidence_reference", "icp_fit_assessment", "signal"]);

function refuse(codes: string[], status = 422): never {
  throw new SignalRefusal(status, "Signal refused", codes);
}

/** Text fields that must pass the PHI boundary guard before anything is stored. */
function textFields(input: RecordInput): Record<string, unknown> {
  return {
    observation: input.observation,
    excerpt: input.excerpt,
    sourceRef: input.source.ref,
    sourceName: input.source.name,
    itemKey: input.source.itemKey,
    approvalCitation: input.approvalCitation,
    regulatoryItem: input.regulatoryItem,
    aiModel: input.aiModel,
    aiPromptVersion: input.aiPromptVersion,
    relevance: input.relevance,
  };
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

export class SignalService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly settings: SignalSettings,
  ) {}

  /** Record a signal (manual, provider or AI path). Refusals are audited with codes and rule ids only. */
  record(actor: SignalActor, input: RecordInput): RecordResult {
    const now = actor.now ?? (() => new Date());
    return auditedRefusals(this.db, actor, "signal.record.refused", "signal", null, () => {
      const decision = guardValue(textFields(input));
      if (decision.decision !== "allow") {
        throw new SignalRefusal(422, "Signal refused", ["phi_guard"], decision.rule_ids);
      }
      return this.db.transaction((tx) => this.recordInTx(tx, actor, input, now));
    });
  }

  /**
   * Provider and AI path (spec FR-001, FR-009): the submission is validated against the ingest schema, then
   * recorded by exactly the same rules as a manual entry. It is always unreviewed, and an AI or system
   * actor can neither confirm a buyer statement nor override reliability.
   */
  ingestSubmission(actor: SignalActor, submission: unknown): RecordResult {
    if (actor.actorType === "human") {
      throw new SignalRefusal(403, "Forbidden", ["ingest_is_for_providers_and_ai"]);
    }
    const parsed = SignalSubmissionSchema.safeParse(submission);
    if (!parsed.success) {
      return auditedRefusals(this.db, actor, "signal.record.refused", "signal", null, () => {
        throw new SignalRefusal(422, "Signal refused", ["invalid_submission"]);
      });
    }
    const s = parsed.data;
    return this.record(
      { ...actor, canOverrideReliability: false },
      {
        accountId: s.accountId,
        contactId: s.contactId,
        typeKey: s.typeKey,
        observation: s.observation,
        excerpt: s.excerpt,
        observedAt: s.observedAt,
        publishedAt: s.publishedAt,
        source: s.source,
        extractionMethod: s.extractionMethod,
        extractionConfidence: s.extractionConfidence,
        evidenceStatus: s.evidenceStatus,
        aiModel: s.aiModel,
        aiPromptVersion: s.aiPromptVersion,
      },
    );
  }

  /** HTTP path: the same as `record`, with the Idempotency-Key record written in the same transaction. */
  recordIdempotent(
    actor: SignalActor,
    input: RecordInput,
    key: string,
  ): IdempotentResult<RecordResult> {
    const now = actor.now ?? (() => new Date());
    return auditedRefusals(this.db, actor, "signal.record.refused", "signal", null, () => {
      const decision = guardValue(textFields(input));
      if (decision.decision !== "allow") {
        throw new SignalRefusal(422, "Signal refused", ["phi_guard"], decision.rule_ids);
      }
      return runIdempotent(this.db, {
        actorId: actor.userId ?? "system",
        route: "POST /signals",
        key,
        body: input,
        successStatus: 201,
        now,
        handler: (tx) => this.recordInTx(tx, actor, input, now),
      });
    });
  }

  private resolveSource(tx: Tx, actor: SignalActor, input: RecordInput, now: () => Date) {
    const s = input.source;
    if (s.sourceId) {
      const found = getSource(tx, s.sourceId);
      if (!found) refuse(["unknown_source"]);
      return found;
    }
    const name = s.name?.trim();
    if (!name) return null;
    const existing = getSourceByName(tx, name);
    if (existing) return existing;
    // An inline source is citation-only until an administrator allows excerpts (research R-09).
    const kind: SourceKind = s.kind ?? "other";
    const id = uuidv7();
    tx.prepare(
      `INSERT INTO signal_source (id, name, kind, default_reliability, storage_rule, excerpt_max_chars,
         availability, created_by, created_at, status_label)
       VALUES (?,?,?,?, 'citation_only', NULL, 'available', ?, ?, 'hypothesis')`,
    ).run(id, name, kind, SOURCE_KIND_RELIABILITY[kind], actor.userId, now().toISOString());
    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "signal.source.create",
        entityType: "signal_source",
        entityId: id,
        outcome: "success",
        after: { kind, inline: true },
        correlationId: actor.correlationId,
      },
      now,
    );
    return getSource(tx, id)!;
  }

  private recordInTx(
    tx: Tx,
    actor: SignalActor,
    input: RecordInput,
    now: () => Date,
  ): RecordResult {
    const at = now().toISOString();

    const scope = resolveAccountScope(tx, input.accountId);
    if (!scope) throw new SignalRefusal(404, "Not found", ["unknown_account"]);
    if (input.contactId) {
      const related = tx
        .prepare(
          `SELECT 1 FROM account_contact_relationship r JOIN contact c ON c.id = r.contact_id
           WHERE r.contact_id = ? AND r.ended_at IS NULL AND c.erased_at IS NULL
             AND r.account_id IN (${scope.ids.map(() => "?").join(",")})`,
        )
        .get(input.contactId, ...scope.ids);
      if (!related) refuse(["contact_not_related_to_account"]);
    }

    const version = currentTaxonomyVersion(tx);
    const type = getType(tx, version, input.typeKey);
    if (!type || type.status !== "active") refuse(["unknown_or_retired_type"]);

    const source = this.resolveSource(tx, actor, input, now);
    const actorKind = actor.actorType;
    const method: ExtractionMethod = input.extractionMethod ?? "manual";
    const evidenceStatus: EvidenceStatus = input.evidenceStatus ?? "observed";

    const refusals = validateNewSignal({
      hasSource: source !== null,
      sourceRef: input.source.ref,
      observation: input.observation,
      observedAt: input.observedAt,
      publishedAt: input.publishedAt,
      evidenceStatus,
      extractionMethod: method,
      extractionConfidence: input.extractionConfidence ?? "medium",
      aiModel: input.aiModel,
      aiPromptVersion: input.aiPromptVersion,
      reliabilityOverride: input.reliability,
      tags: input.relevance,
      actorKind,
      sourceKind: (source?.kind as SourceKind | undefined) ?? null,
    });
    if (input.reliability !== undefined && actor.canOverrideReliability !== true) {
      refusals.push({ code: "reliability_override_not_allowed", field: "reliability" });
    }
    if (refusals.length > 0 || source === null) {
      refuse([...new Set(refusals.map((r) => `${r.code}:${r.field}`))]);
    }
    for (const link of [...(input.supports ?? []), ...(input.contradicts ?? [])]) {
      if (!LINK_TYPES.has(link.entityType)) refuse(["invalid_link_type"]);
    }

    const funding = classifyFunding({
      typeKey: type.key,
      typeKind: type.kind,
      evidenceStatus,
      requested: input.fundingClass,
      approvalCitation: input.approvalCitation,
    });
    if (!funding.ok) refuse([funding.code]);
    const regulatory = applyRegulatoryRules({
      typeKind: type.kind,
      requestedStatus: input.regulatoryStatus,
      regulatoryItem: input.regulatoryItem,
      observation: input.observation,
    });
    if (!regulatory.ok) refuse([regulatory.code]);

    const observation = input.observation.trim();
    const fingerprint = contentFingerprint(scope.survivor, type.key, observation);
    const itemKey = input.source.itemKey?.trim() || null;
    const sourceRef = input.source.ref.trim();

    // De-duplication against the signals of the same account (survivor and merged-away accounts).
    const candidates = this.loadCandidates(tx, scope.ids, type.key);
    const decision = decideDuplicate(
      {
        accountId: scope.survivor,
        typeKey: type.key,
        sourceId: source.id,
        itemKey,
        fingerprint,
        observation,
      },
      candidates,
      this.settings.similarityThreshold,
    );

    if (decision.kind === "identical") {
      return { outcome: "already_exists", signal: getSignalDetail(tx, decision.signalId, now()) };
    }
    if (decision.kind === "merge") {
      return this.merge(tx, actor, decision, {
        fingerprint,
        source,
        sourceRef,
        at,
        now,
      });
    }

    const excerpt = applyExcerptRule(input.excerpt, this.settings.excerptMaxChars, {
      storageRule: source.storage_rule,
      excerptMaxChars: source.excerpt_max_chars,
    });
    const published = input.publishedAt ?? null;
    const collectedAt = at;
    const dates = {
      publishedAt: published,
      collectedAt,
      observedAt: input.observedAt,
      kind: type.kind,
    };
    const fresh = computeFreshUntil(freshAnchor(dates), type.default_freshness_days);
    const reliability: Reliability = input.reliability ?? source.default_reliability;
    const citationOnly = source.storage_rule === "citation_only";
    const retainUntil = citationOnly
      ? "9999-12-31T00:00:00.000Z" // kept as long as the account (open question #39)
      : addMonths(collectedAt, this.settings.retentionMonths);
    const id = uuidv7();
    tx.prepare(
      `INSERT INTO signal (id, account_id, contact_id, type_key, taxonomy_version, source_id, source_ref,
         source_ref_normalised, item_key, observation, excerpt, excerpt_withheld_reason, observed_at,
         collected_at, published_at, undated, reliability, reliability_overridden_by, extraction_method,
         extraction_confidence, ai_model, ai_prompt_version, evidence_status, review_status,
         new_provenance_flag, freshness_days, fresh_until, freshness_state, funding_class, approval_citation,
         regulatory_item, regulatory_status, context_only, reverify_required, retention_policy, retain_until,
         sensitivity, content_fingerprint, created_by, created_by_type, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,?,?,'fresh',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      scope.survivor,
      input.contactId ?? null,
      type.key,
      version,
      source.id,
      sourceRef,
      canonicaliseSourceRef(sourceRef),
      itemKey,
      observation,
      excerpt.excerpt,
      excerpt.withheldReason,
      input.observedAt,
      collectedAt,
      published,
      isUndated(dates) ? 1 : 0,
      reliability,
      input.reliability && actor.userId ? actor.userId : null,
      method,
      input.extractionConfidence ?? "medium",
      input.aiModel ?? null,
      input.aiPromptVersion ?? null,
      evidenceStatus,
      type.default_freshness_days,
      fresh,
      funding.ok ? funding.fundingClass : "none",
      funding.ok ? funding.approvalCitation : null,
      input.regulatoryItem ?? null,
      regulatory.ok ? regulatory.regulatoryStatus : null,
      regulatory.ok && regulatory.contextOnly ? 1 : 0,
      regulatory.ok && regulatory.reverifyRequired ? 1 : 0,
      citationOnly ? "account_lifetime" : "business_record",
      retainUntil,
      deriveSensitivity({
        sourceKind: source.kind as SourceKind,
        hasContact: Boolean(input.contactId),
      }),
      fingerprint,
      actor.userId,
      actor.actorType,
      at,
      at,
    );

    const tagInsert = tx.prepare(
      "INSERT OR IGNORE INTO signal_tag (signal_id, dimension, value) VALUES (?,?,?)",
    );
    for (const [dimension, values] of [
      ["icp", input.relevance?.icp],
      ["capability", input.relevance?.capability],
      ["offer", input.relevance?.offer],
    ] as const) {
      for (const value of values ?? []) tagInsert.run(id, dimension, value);
    }
    const linkInsert = tx.prepare(
      `INSERT OR IGNORE INTO signal_link (id, signal_id, entity_type, entity_id, role, linked_by, linked_at)
       VALUES (?,?,?,?,?,?,?)`,
    );
    for (const l of input.supports ?? [])
      linkInsert.run(uuidv7(), id, l.entityType, l.entityId, "supporting", actor.userId, at);
    for (const l of input.contradicts ?? [])
      linkInsert.run(uuidv7(), id, l.entityType, l.entityId, "contradictory", actor.userId, at);

    appendProvenance(tx, id, {
      kind: "first_recorded",
      actorId: actor.userId,
      actorType: actor.actorType,
      method,
      sourceId: source.id,
      sourceRef,
      detail: {
        fingerprint,
        taxonomy_version: version,
        ...(input.reliability ? { reliability_overridden: true } : {}),
      },
      at,
    });
    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "signal.record",
        entityType: "signal",
        entityId: id,
        outcome: "success",
        after: {
          type_key: type.key,
          taxonomy_version: version,
          extraction_method: method,
          excerpt: excerpt.withheldReason,
        },
        correlationId: actor.correlationId,
      },
      now,
    );
    emitDiscovered(
      tx,
      { ...actor, actorId: actor.userId },
      {
        signalId: id,
        accountId: scope.survivor,
        typeKey: type.key,
        merged: false,
      },
    );
    return { outcome: "created", signal: getSignalDetail(tx, id, now()) };
  }

  private loadCandidates(tx: Tx, accountIds: string[], typeKey: string): DedupCandidate[] {
    const marks = accountIds.map(() => "?").join(",");
    const rows = tx
      .prepare(
        `SELECT id, account_id, type_key, source_id, item_key, observation, content_fingerprint
         FROM signal WHERE type_key = ? AND account_id IN (${marks})`,
      )
      .all(typeKey, ...accountIds) as Pick<
      SignalRow,
      | "id"
      | "account_id"
      | "type_key"
      | "source_id"
      | "item_key"
      | "observation"
      | "content_fingerprint"
    >[];
    return rows.map((r) => {
      const merges = tx
        .prepare(
          "SELECT source_id, detail FROM signal_provenance WHERE signal_id = ? AND kind IN ('merged_duplicate','republication')",
        )
        .all(r.id) as { source_id: string | null; detail: string }[];
      const seen = [{ fingerprint: r.content_fingerprint, sourceId: r.source_id }];
      for (const m of merges) {
        const fp = (JSON.parse(m.detail) as { fingerprint?: string }).fingerprint;
        if (fp && m.source_id) seen.push({ fingerprint: fp, sourceId: m.source_id });
      }
      // The first recording's source and every merged source are all "seen" for the first fingerprint.
      return {
        id: r.id,
        accountId: accountIds[0]!,
        typeKey: r.type_key,
        sourceId: r.source_id,
        itemKey: r.item_key,
        observationNormalised: normaliseObservation(r.observation),
        seen,
      };
    });
  }

  private merge(
    tx: Tx,
    actor: SignalActor,
    decision: { signalId: string; reason: "republication" | "duplicate" },
    ctx: { fingerprint: string; source: SourceRow; sourceRef: string; at: string; now: () => Date },
  ): RecordResult {
    const target = getSignal(tx, decision.signalId)!;
    const kind = decision.reason === "republication" ? "republication" : "merged_duplicate";
    appendProvenance(tx, target.id, {
      kind,
      actorId: actor.userId,
      actorType: actor.actorType,
      method: "dedup",
      sourceId: ctx.source.id,
      sourceRef: ctx.sourceRef,
      detail: { fingerprint: ctx.fingerprint },
      at: ctx.at,
    });
    // A merge into an approved signal keeps it approved and flags it until a reviewer clears the flag.
    const flag = target.review_status === "approved" ? 1 : target.new_provenance_flag;
    tx.prepare("UPDATE signal SET new_provenance_flag = ?, updated_at = ? WHERE id = ?").run(
      flag,
      ctx.at,
      target.id,
    );
    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "signal.merge",
        entityType: "signal",
        entityId: target.id,
        outcome: "success",
        after: { kind, flagged: flag === 1 },
        correlationId: actor.correlationId,
      },
      ctx.now,
    );
    emitDiscovered(
      tx,
      { ...actor, actorId: actor.userId },
      {
        signalId: target.id,
        accountId: target.account_id,
        typeKey: target.type_key,
        merged: true,
      },
    );
    return {
      outcome: "merged",
      mergeKind: kind,
      signal: getSignalDetail(tx, target.id, ctx.now()),
    };
  }

  /** Materialise the stale flag (the optional daily job; correctness never depends on it). */
  markStale(actor: SignalActor): number {
    const now = actor.now ?? (() => new Date());
    return this.db.transaction((tx) => {
      const at = now().toISOString();
      const rows = tx
        .prepare("SELECT id FROM signal WHERE freshness_state = 'fresh' AND fresh_until <= ?")
        .all(at) as { id: string }[];
      for (const r of rows) {
        tx.prepare("UPDATE signal SET freshness_state = 'stale', updated_at = ? WHERE id = ?").run(
          at,
          r.id,
        );
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "signal.stale",
            entityType: "signal",
            entityId: r.id,
            outcome: "success",
            correlationId: actor.correlationId,
          },
          now,
        );
      }
      return rows.length;
    });
  }

  /** Reduce signals past their retention to a bare citation (spec FR-015). */
  applyRetention(actor: SignalActor): number {
    const now = actor.now ?? (() => new Date());
    return this.db.transaction((tx) => {
      const at = now().toISOString();
      const rows = tx
        .prepare("SELECT id FROM signal WHERE purged_at IS NULL AND retain_until <= ?")
        .all(at) as { id: string }[];
      for (const r of rows) {
        tx.prepare(
          "UPDATE signal SET observation = '[removed by retention policy]', excerpt = NULL, purged_at = ?, updated_at = ? WHERE id = ?",
        ).run(at, at, r.id);
        appendProvenance(tx, r.id, {
          kind: "retention",
          actorId: actor.userId,
          actorType: actor.actorType,
          method: "retention",
          detail: {},
          at,
        });
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "signal.retention",
            entityType: "signal",
            entityId: r.id,
            outcome: "success",
            correlationId: actor.correlationId,
          },
          now,
        );
      }
      return rows.length;
    });
  }

  /** Clear the contact link when a contact is erased (spec edge case); the observation stays. */
  clearContact(tx: Tx, contactId: string, actor: SignalActor): number {
    const now = actor.now ?? (() => new Date());
    const at = now().toISOString();
    const rows = tx.prepare("SELECT id FROM signal WHERE contact_id = ?").all(contactId) as {
      id: string;
    }[];
    for (const r of rows) {
      tx.prepare("UPDATE signal SET contact_id = NULL, updated_at = ? WHERE id = ?").run(at, r.id);
      appendProvenance(tx, r.id, {
        kind: "contact_erased",
        actorId: actor.userId,
        actorType: actor.actorType,
        detail: {},
        at,
      });
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "signal.contact.cleared",
          entityType: "signal",
          entityId: r.id,
          outcome: "success",
          correlationId: actor.correlationId,
        },
        now,
      );
    }
    return rows.length;
  }

  get(id: string, now: Date = new Date()): SignalDetail {
    return this.db.transaction((tx) => getSignalDetail(tx, id, now));
  }
}
