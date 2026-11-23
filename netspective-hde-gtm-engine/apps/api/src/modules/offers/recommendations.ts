import {
  OfferRecommendationInputSchema,
  validateRanking,
  type OfferRecommendationInput,
} from "@gtm/ai-contracts";
import type { SqliteDatabase } from "@gtm/db";
import {
  evaluate,
  explain,
  guardValue,
  isSupported,
  type Alternative,
  type Evaluation,
  type Exclusion,
  type ExclusionCode,
  type MatchedRule,
  type Outcome,
  type RoutingBand,
  type RoutingContext,
  type RoutingConfig,
  type Trigger,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { HttpError, parseOrThrow } from "../../http/errors.js";
import {
  audited,
  auditedAsync,
  CatalogueRefusal,
  guardFreeText,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { recordAudit } from "../audit/index.js";
import { buildModelInput, type LlmGateway } from "../providers/index.js";
import { ctxOf, emitOfferRecommended } from "./events.js";
import type { Recommender } from "./ports.js";
import type { RoutingContextBuilder } from "./routing-context.js";
import type { RuleSetService } from "./rule-sets.js";

// Offer recommendations (feature 006, spec FR-001 to FR-008, research R-03, R-04, R-06, R-14). Eligibility
// and routing are the pure engine; a language model may only explain or order the offers that remain,
// and its answer is refused if it names anything else. A recommendation is stored append-only with the
// rule set version and a hash of the inputs; "out of date" is computed at read.

export interface RecommendationSettings {
  recommendationAi: boolean;
  supportedMinBand: RoutingBand;
  /** The per-call cap for the explanation step (micro-units). */
  aiCapMicros: number;
}

export const RecommendInputSchema = z
  .object({ accountId: z.string().min(1), contactId: z.string().min(1).optional() })
  .strict();
export const DismissInputSchema = z.object({ reason: z.string().min(3).max(300) }).strict();

export interface RecommendationView {
  id: string;
  accountId: string;
  contactId: string | null;
  trigger: Trigger;
  requestId: string | null;
  ruleSetVersion: number;
  outcome: Outcome;
  offerId: string | null;
  offerKey: string | null;
  outreach: "allowed" | "blocked";
  blockedReasons: ExclusionCode[];
  eligible: { offerKey: string; reason: string }[];
  excluded: Exclusion[];
  matched: MatchedRule[];
  alternatives: (Alternative & { offerId: string | null })[];
  ranking: string[] | null;
  explanation: string;
  limitations: string[];
  aiUsed: boolean;
  aiFallback: boolean;
  reviewState: "pending" | "accepted" | "dismissed";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  createdAt: string;
  /** The inputs have changed since this recommendation was made (computed at read). */
  outOfDate: boolean;
}

interface Row {
  id: string;
  account_id: string;
  contact_id: string | null;
  trigger: Trigger;
  request_id: string | null;
  rule_set_version: number;
  outcome: Outcome;
  offer_id: string | null;
  outreach: "allowed" | "blocked";
  blocked_reasons_json: string;
  eligible_json: string;
  excluded_json: string;
  matched_json: string;
  alternatives_json: string;
  ranking_json: string | null;
  explanation: string;
  limitations_json: string;
  ai_invocation_id: string | null;
  ai_fallback: number;
  inputs_hash: string;
  review_state: "pending" | "accepted" | "dismissed";
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  created_at: string;
}

export class RecommendationService implements Recommender {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly rules: RuleSetService,
    private readonly builder: RoutingContextBuilder,
    private readonly llm: Pick<LlmGateway, "call"> | null,
    private readonly settings: RecommendationSettings,
  ) {}

  private get config(): RoutingConfig {
    return { supportedMinBand: this.settings.supportedMinBand };
  }

  // ---- create ------------------------------------------------------------------------------------

  /** An operator asks for a recommendation (needs `offers.recommend`). */
  recommend(actor: CatalogueActor, raw: unknown): Promise<RecommendationView> {
    const input = parseOrThrow(RecommendInputSchema, raw);
    return auditedAsync(
      this.db,
      actor,
      "offer.recommend.refused",
      "account",
      input.accountId,
      async () => {
        requirePermission(actor, "offers.recommend");
        const { id } = await this.create(actor, {
          accountId: input.accountId,
          contactId: input.contactId ?? null,
          trigger: "operator",
          requestId: null,
        });
        return this.view(id, nowOf(actor));
      },
    );
  }

  /** The port `engagement` calls after a download: a system actor, trigger `offer5_download`. */
  async recommendForRequest(input: {
    accountId: string;
    contactId: string | null;
    requestId: string;
    correlationId: string | null;
  }): Promise<{ recommendationId: string; created: boolean }> {
    const actor: CatalogueActor = {
      userId: null,
      actorType: "system",
      correlationId: input.correlationId,
      permissions: [],
    };
    const r = await this.create(actor, {
      accountId: input.accountId,
      contactId: input.contactId,
      trigger: "offer5_download",
      requestId: input.requestId,
    });
    return { recommendationId: r.id, created: r.created };
  }

  private async create(
    actor: CatalogueActor,
    p: { accountId: string; contactId: string | null; trigger: Trigger; requestId: string | null },
  ): Promise<{ id: string; created: boolean }> {
    const now = nowOf(actor);
    const active = this.rules.active();
    const built = this.builder.build({ ...p, rules: active.rules, now });
    const existing = this.db.raw
      .prepare(
        `SELECT id FROM offer_recommendation WHERE account_id = ? AND COALESCE(contact_id,'') = ? AND trigger = ?
           AND inputs_hash = ? AND rule_set_version = ? AND review_state = 'pending' ORDER BY rowid DESC LIMIT 1`,
      )
      .get(p.accountId, p.contactId ?? "", p.trigger, built.inputsHash, active.version) as
      { id: string } | undefined;
    if (existing) return { id: existing.id, created: false };

    const ev = evaluate(built.context, active.rules, active.version, this.config);
    const id = uuidv7();
    let explanation = explain(built.context, ev, this.config);
    let ranking: string[] | null = null;
    let aiInvocationId: string | null = null;
    let aiFallback = false;

    if (
      this.settings.recommendationAi &&
      this.llm &&
      ev.outreach.allowed &&
      ev.eligible.length > 0
    ) {
      const ai = await this.explainWithModel(actor, id, built.context, ev);
      if (ai.ok) {
        explanation = ai.explanation;
        ranking = ai.ranking;
      } else aiFallback = true;
      aiInvocationId = ai.invocationId;
    }

    const offerId = ev.offerKey
      ? (built.context.offers.find((o) => o.key === ev.offerKey)?.id ?? null)
      : null;
    this.db.transaction((tx) => {
      tx.prepare(
        `INSERT INTO offer_recommendation (id, account_id, contact_id, trigger, request_id, rule_set_version,
           outcome, offer_id, outreach, blocked_reasons_json, eligible_json, excluded_json, matched_json,
           alternatives_json, ranking_json, explanation, limitations_json, ai_invocation_id, ai_fallback,
           inputs_hash, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        p.accountId,
        p.contactId,
        p.trigger,
        p.requestId,
        active.version,
        ev.outcome,
        offerId,
        ev.outreach.allowed ? "allowed" : "blocked",
        JSON.stringify(ev.outreach.reasons),
        JSON.stringify(ev.eligible),
        JSON.stringify(ev.excluded),
        JSON.stringify(ev.matched),
        JSON.stringify(ev.alternatives),
        ranking ? JSON.stringify(ranking) : null,
        explanation,
        JSON.stringify(ev.limitations),
        aiInvocationId,
        aiFallback ? 1 : 0,
        built.inputsHash,
        actor.userId,
        now.toISOString(),
      );
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "offer.recommend",
          entityType: "offer_recommendation",
          entityId: id,
          outcome: "success",
          after: {
            outcome: ev.outcome,
            outreach: ev.outreach.allowed ? "allowed" : "blocked",
            rule_set_version: active.version,
            trigger: p.trigger,
          },
          correlationId: actor.correlationId,
        },
        actor.now,
      );
      emitOfferRecommended(tx, ctxOf(actor), {
        recommendationId: id,
        accountId: p.accountId,
        outcome: ev.outcome,
        outreach: ev.outreach.allowed ? "allowed" : "blocked",
        ruleSetVersion: active.version,
      });
    });
    return { id, created: true };
  }

  /** The optional explanation step. Never changes the outcome, the offer or the outreach decision. */
  private async explainWithModel(
    actor: CatalogueActor,
    recommendationId: string,
    ctx: RoutingContext,
    ev: Evaluation,
  ): Promise<
    | { ok: true; explanation: string; ranking: string[]; invocationId: string | null }
    | { ok: false; invocationId: string | null }
  > {
    const eligibleOffers = ev.eligible.map((e) => ctx.offers.find((o) => o.key === e.offerKey)!);
    const input: OfferRecommendationInput = {
      eligible: eligibleOffers.map((o) => ({ id: o.id, key: o.key, number: o.number })),
      matchedRules: ev.matched.map((m) => m.ruleId),
      fit: ctx.account.fit,
      hypotheses: ctx.hypotheses
        .filter((h) => h.acceptance === "accepted")
        .map((h) => ({ category: h.category, supported: isSupported(h, this.config) })),
      capacity: ctx.offers.map((o) => ({ offerKey: o.key, state: o.capacity })),
      limitations: ev.limitations,
    };
    const checked = OfferRecommendationInputSchema.safeParse(input);
    if (!checked.success || !this.llm) return { ok: false, invocationId: null };
    const result = await this.llm.call({
      task: "synthesis",
      promptName: "offer-explain",
      modelInput: buildModelInput({
        account: { name: "account", type: "recommendation" },
        sources: [],
        signalObservations: [],
        reference: { signalTypeKeys: [], categoryKeys: [], capabilityKeys: [] },
        recommendation: checked.data,
      }),
      contextType: "other",
      contextId: recommendationId,
      accountId: ctx.account.id,
      runCapMicros: this.settings.aiCapMicros,
      accountRemaining: () => this.settings.aiCapMicros,
      actor: { id: actor.userId, type: actor.actorType },
      correlationId: actor.correlationId,
    });
    const invocation = this.db.raw
      .prepare(
        "SELECT id FROM ai_invocation WHERE context_type = 'other' AND context_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(recommendationId) as { id: string } | undefined;
    const invocationId = invocation?.id ?? null;
    if (!result.ok) return { ok: false, invocationId };
    const data = result.data as { ranking: string[]; explanation: string };
    const ranking = validateRanking(
      data.ranking,
      eligibleOffers.map((o) => o.id),
    );
    if (!ranking.ok) return { ok: false, invocationId };
    if (guardValue({ explanation: data.explanation }).decision !== "allow") {
      return { ok: false, invocationId };
    }
    return { ok: true, explanation: data.explanation, ranking: data.ranking, invocationId };
  }

  // ---- reads -------------------------------------------------------------------------------------

  private row(id: string): Row | undefined {
    return this.db.raw.prepare("SELECT * FROM offer_recommendation WHERE id = ?").get(id) as
      Row | undefined;
  }

  private view(id: string, now: Date): RecommendationView {
    const r = this.row(id);
    if (!r) throw new HttpError(404, "Recommendation not found");
    return this.toView(r, now);
  }

  private toView(r: Row, now: Date): RecommendationView {
    const offer = r.offer_id
      ? (this.db.raw.prepare("SELECT key FROM engagement_offer WHERE id = ?").get(r.offer_id) as
          { key: string } | undefined)
      : undefined;
    return {
      id: r.id,
      accountId: r.account_id,
      contactId: r.contact_id,
      trigger: r.trigger,
      requestId: r.request_id,
      ruleSetVersion: r.rule_set_version,
      outcome: r.outcome,
      offerId: r.offer_id,
      offerKey: offer?.key ?? null,
      outreach: r.outreach,
      blockedReasons: JSON.parse(r.blocked_reasons_json) as ExclusionCode[],
      eligible: JSON.parse(r.eligible_json) as RecommendationView["eligible"],
      excluded: JSON.parse(r.excluded_json) as Exclusion[],
      matched: JSON.parse(r.matched_json) as MatchedRule[],
      alternatives: (JSON.parse(r.alternatives_json) as Alternative[]).map((a) => ({
        ...a,
        offerId: a.offerKey
          ? ((
              this.db.raw
                .prepare("SELECT id FROM engagement_offer WHERE key = ?")
                .get(a.offerKey) as { id: string } | undefined
            )?.id ?? null)
          : null,
      })),
      ranking: r.ranking_json ? (JSON.parse(r.ranking_json) as string[]) : null,
      explanation: r.explanation,
      limitations: JSON.parse(r.limitations_json) as string[],
      aiUsed: r.ai_invocation_id !== null && r.ai_fallback === 0,
      aiFallback: r.ai_fallback === 1,
      reviewState: r.review_state,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      reviewReason: r.review_reason,
      createdAt: r.created_at,
      outOfDate: this.isOutOfDate(r, now),
    };
  }

  private isOutOfDate(r: Row, now: Date): boolean {
    const rules = this.rules.byVersion(r.rule_set_version);
    if (!rules) return false;
    const fresh = this.builder.build({
      accountId: r.account_id,
      contactId: r.contact_id,
      trigger: r.trigger,
      rules: rules.rules,
      now,
    });
    return fresh.inputsHash !== r.inputs_hash;
  }

  get(actor: CatalogueActor, id: string): RecommendationView {
    return audited(
      this.db,
      actor,
      "offer.recommendation.read.refused",
      "offer_recommendation",
      id,
      () => {
        requirePermission(actor, "offers.read");
        const r = this.row(id);
        if (!r) throw new CatalogueRefusal(404, "Not found", ["unknown_recommendation"]);
        return this.toView(r, nowOf(actor));
      },
    );
  }

  listForAccount(actor: CatalogueActor, accountId: string): RecommendationView[] {
    return audited(
      this.db,
      actor,
      "offer.recommendation.read.refused",
      "account",
      accountId,
      () => {
        requirePermission(actor, "offers.read");
        const now = nowOf(actor);
        return (
          this.db.raw
            .prepare("SELECT * FROM offer_recommendation WHERE account_id = ? ORDER BY rowid DESC")
            .all(accountId) as unknown as Row[]
        ).map((r) => this.toView(r, now));
      },
    );
  }

  /** Pending recommendations from downloads, oldest first, for the review queue. */
  pendingQueue(actor: CatalogueActor): RecommendationView[] {
    return audited(
      this.db,
      actor,
      "offer.recommendation.read.refused",
      "offer_recommendation",
      null,
      () => {
        requirePermission(actor, "offers.read");
        const now = nowOf(actor);
        return (
          this.db.raw
            .prepare(
              "SELECT * FROM offer_recommendation WHERE review_state = 'pending' ORDER BY rowid",
            )
            .all() as unknown as Row[]
        ).map((r) => this.toView(r, now));
      },
    );
  }

  // ---- review ------------------------------------------------------------------------------------

  accept(actor: CatalogueActor, id: string): RecommendationView {
    return audited(
      this.db,
      actor,
      "offer.recommendation.accept.refused",
      "offer_recommendation",
      id,
      () => {
        requirePermission(actor, "offers.recommend");
        const r = this.pending(id);
        const now = nowOf(actor);
        if (r.outcome === "offer") this.recheck(r, now);
        this.finish(actor, r, "accepted", null, now);
        return this.view(id, now);
      },
    );
  }

  dismiss(actor: CatalogueActor, id: string, raw: unknown): RecommendationView {
    const input = parseOrThrow(DismissInputSchema, raw);
    return audited(
      this.db,
      actor,
      "offer.recommendation.dismiss.refused",
      "offer_recommendation",
      id,
      () => {
        requirePermission(actor, "offers.recommend");
        guardFreeText({ reason: input.reason });
        const r = this.pending(id);
        const now = nowOf(actor);
        this.finish(actor, r, "dismissed", input.reason, now);
        return this.view(id, now);
      },
    );
  }

  private pending(id: string): Row {
    const r = this.row(id);
    if (!r) throw new CatalogueRefusal(404, "Not found", ["unknown_recommendation"]);
    if (r.review_state !== "pending") {
      throw new CatalogueRefusal(
        409,
        "Conflict",
        ["already_reviewed"],
        [],
        "This recommendation has already been reviewed.",
      );
    }
    return r;
  }

  /** Accepting an offer re-checks capacity, availability and suppression against the facts now. */
  private recheck(r: Row, now: Date): void {
    const rules = this.rules.byVersion(r.rule_set_version);
    if (!rules) return;
    const fresh = this.builder.build({
      accountId: r.account_id,
      contactId: r.contact_id,
      trigger: r.trigger,
      rules: rules.rules,
      now,
    });
    const ev = evaluate(fresh.context, rules.rules, r.rule_set_version, this.config);
    const offerKey = (
      this.db.raw.prepare("SELECT key FROM engagement_offer WHERE id = ?").get(r.offer_id) as {
        key: string;
      }
    ).key;
    if (!ev.outreach.allowed) {
      throw new CatalogueRefusal(
        409,
        "Cannot accept",
        [...ev.outreach.reasons],
        [],
        "Outreach is no longer allowed for this account or contact.",
      );
    }
    if (!ev.eligible.some((e) => e.offerKey === offerKey)) {
      const why = ev.excluded.find((e) => e.offerKey === offerKey)?.code ?? "offer_unavailable";
      throw new CatalogueRefusal(
        409,
        "Cannot accept",
        [why],
        [],
        "The offer can no longer be recommended: it is full or not available.",
      );
    }
  }

  private finish(
    actor: CatalogueActor,
    r: Row,
    state: "accepted" | "dismissed",
    reason: string | null,
    now: Date,
  ): void {
    this.db.transaction((tx) => {
      tx.prepare(
        "UPDATE offer_recommendation SET review_state = ?, reviewed_by = ?, reviewed_at = ?, review_reason = ? WHERE id = ?",
      ).run(state, actor.userId as string, now.toISOString(), reason, r.id);
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action:
            state === "accepted" ? "offer.recommendation.accept" : "offer.recommendation.dismiss",
          entityType: "offer_recommendation",
          entityId: r.id,
          outcome: "success",
          after: { review_state: state, outcome: r.outcome },
          correlationId: actor.correlationId,
        },
        actor.now,
      );
    });
  }
}
