import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  checkStatement,
  flagReason,
  guardValue,
  isStaleDue,
  type HypothesisStatus,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { HttpError } from "../../http/errors.js";
import { recordAudit } from "../audit/index.js";
import { accountFacts, resolveAccountScope as scopeOf } from "./accounts.js";
import { getSignalDetail } from "../signals/index.js";
import { emitCreated, emitUpdated } from "./events.js";
import { anchorFor, evidenceView } from "./evidence.js";
import { audited, HypothesisRefusal, type HypothesisActor } from "./refusal.js";
import { getHypothesis, listDecisions, listEvidence, type HypothesisRow } from "./repository.js";

// Hypotheses: create, accept, dismiss, edit, link evidence, add assumptions and read models (tasks T043,
// T047 reads). Only a person acts here; AI actors are refused. Everything audited in the same transaction.

export interface Relevance {
  icp?: string[] | undefined;
  capability?: string[] | undefined;
  offer?: string[] | undefined;
}
export interface HypothesisInput {
  statement: string;
  category: string;
  relevance?: Relevance | undefined;
  supportingSignalIds: string[];
  contradictorySignalIds?: string[] | undefined;
  assumptions?: string[] | undefined;
  confidence: { band: "low" | "medium" | "high"; explanation: string };
}
export interface HypothesisPatch {
  statement?: string | undefined;
  category?: string | undefined;
  relevance?: Relevance | undefined;
  confidence?: { band: "low" | "medium" | "high"; explanation: string } | undefined;
}

export const BAND_DEFINITIONS = {
  low: "Little or weak evidence; the statement is a first guess.",
  medium: "Some evidence supports the statement; important points are unconfirmed.",
  high: "Several reliable observations support the statement; it is still a hypothesis until a buyer confirms it.",
} as const;

const TAG_KEY = /^[a-z0-9_]{1,60}$/;

export class HypothesisService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly staleDays = 90,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private requireHuman(actor: HypothesisActor): void {
    if (actor.actorType !== "human" || !actor.userId)
      throw new HypothesisRefusal(403, "Forbidden", ["must_be_human"]);
  }

  private checkText(parts: Record<string, unknown>): void {
    const g = guardValue(parts);
    if (g.decision !== "allow")
      throw new HypothesisRefusal(422, "Hypothesis refused", ["phi_guard"], g.rule_ids);
  }

  private checkRelevance(tx: Tx, r: Relevance | undefined): void {
    for (const v of r?.icp ?? [])
      if (v !== "icp1" && v !== "icp2")
        throw new HypothesisRefusal(422, "Hypothesis refused", ["invalid_tag:icp"]);
    for (const v of r?.capability ?? []) {
      const ok = tx
        .prepare("SELECT 1 FROM service_capability_provisional WHERE key = ? AND active = 1")
        .get(v);
      if (!ok) throw new HypothesisRefusal(422, "Hypothesis refused", ["invalid_tag:capability"]);
    }
    for (const v of r?.offer ?? [])
      if (!TAG_KEY.test(v))
        throw new HypothesisRefusal(422, "Hypothesis refused", ["invalid_tag:offer"]);
  }

  private checkSignals(tx: Tx, accountIds: string[], ids: string[]): void {
    for (const id of ids) {
      const s = tx.prepare("SELECT account_id FROM signal WHERE id = ?").get(id) as
        { account_id: string } | undefined;
      if (!s) throw new HypothesisRefusal(404, "Not found", ["unknown_signal"]);
      if (!accountIds.includes(s.account_id))
        throw new HypothesisRefusal(422, "Hypothesis refused", ["signal_of_another_account"]);
    }
  }

  private writeTags(tx: Tx, id: string, r: Relevance | undefined): void {
    const ins = tx.prepare(
      "INSERT OR IGNORE INTO hypothesis_tag (hypothesis_id, dimension, value) VALUES (?,?,?)",
    );
    for (const [dimension, values] of [
      ["icp", r?.icp],
      ["capability", r?.capability],
      ["offer", r?.offer],
    ] as const) {
      for (const v of values ?? []) ins.run(id, dimension, v);
    }
  }

  create(actor: HypothesisActor, accountId: string, input: HypothesisInput): HypothesisView {
    const now = actor.now ?? (() => new Date());
    return audited(this.db, actor, "hypothesis.create.refused", null, () => {
      this.requireHuman(actor);
      const id = this.db.transaction((tx) => {
        const scope = scopeOf(tx, accountId);
        if (!scope) throw new HypothesisRefusal(404, "Not found", ["unknown_account"]);
        const statement = input.statement.trim();
        const stmt = checkStatement(statement);
        if (!stmt.ok) throw new HypothesisRefusal(422, "Hypothesis refused", [stmt.code]);
        this.checkText({
          statement,
          explanation: input.confidence.explanation,
          assumptions: input.assumptions,
          relevance: input.relevance,
        });
        const cat = tx
          .prepare("SELECT 1 FROM hypothesis_category WHERE key = ? AND active = 1")
          .get(input.category);
        if (!cat) throw new HypothesisRefusal(422, "Hypothesis refused", ["unknown_category"]);
        if (input.supportingSignalIds.length === 0)
          throw new HypothesisRefusal(422, "Hypothesis refused", ["supporting_signal_required"]);
        if (input.confidence.explanation.trim().length < 3)
          throw new HypothesisRefusal(422, "Hypothesis refused", ["explanation_required"]);
        const contradictory = input.contradictorySignalIds ?? [];
        if (contradictory.some((s) => input.supportingSignalIds.includes(s)))
          throw new HypothesisRefusal(422, "Hypothesis refused", [
            "signal_both_supporting_and_contradictory",
          ]);
        this.checkSignals(tx, scope.ids, [...input.supportingSignalIds, ...contradictory]);
        this.checkRelevance(tx, input.relevance);
        const facts = accountFacts(tx, scope.survivor);
        const at = now().toISOString();
        const hid = uuidv7();
        tx.prepare(
          `INSERT INTO account_hypothesis (id, account_id, origin, acceptance, statement, category, status, not_for_prioritisation,
             confidence_band, confidence_explanation, created_by, created_at, accepted_by, accepted_at, last_reviewed_at, updated_at)
           VALUES (?,?,'analyst','accepted',?,?, 'untested', ?, ?,?,?,?,?,?,?,?)`,
        ).run(
          hid,
          scope.survivor,
          statement,
          input.category,
          facts?.excluded ? 1 : 0,
          input.confidence.band,
          input.confidence.explanation.trim(),
          actor.userId,
          at,
          actor.userId,
          at,
          at,
          at,
        );
        const link = tx.prepare(
          "INSERT INTO hypothesis_evidence (id, hypothesis_id, signal_id, role, linked_by, linked_by_type, linked_at) VALUES (?,?,?,?,?,'human',?)",
        );
        for (const s of input.supportingSignalIds)
          link.run(uuidv7(), hid, s, "supporting", actor.userId, at);
        for (const s of contradictory)
          link.run(uuidv7(), hid, s, "contradictory", actor.userId, at);
        this.writeTags(tx, hid, input.relevance);
        const ass = tx.prepare(
          "INSERT INTO hypothesis_assumption (id, hypothesis_id, text, source, added_by, added_at) VALUES (?,?,?,'analyst',?,?)",
        );
        for (const a of input.assumptions ?? []) ass.run(uuidv7(), hid, a.trim(), actor.userId, at);
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: "human",
            action: "hypothesis.create",
            entityType: "account_hypothesis",
            entityId: hid,
            outcome: "success",
            after: {
              category: input.category,
              supporting: input.supportingSignalIds.length,
              contradictory: contradictory.length,
            },
            correlationId: actor.correlationId,
          },
          now,
        );
        emitCreated(
          tx,
          { ...actor, actorId: actor.userId, now },
          { hypothesisId: hid, accountId: scope.survivor, origin: "analyst" },
        );
        return hid;
      });
      return this.get(id, now());
    });
  }

  accept(actor: HypothesisActor, id: string): HypothesisView {
    const now = actor.now ?? (() => new Date());
    return audited(this.db, actor, "hypothesis.accept.refused", id, () => {
      this.requireHuman(actor);
      this.db.transaction((tx) => {
        const h = getHypothesis(tx, id);
        if (!h) throw new HypothesisRefusal(404, "Not found", ["unknown_hypothesis"]);
        if (h.acceptance !== "proposed")
          throw new HypothesisRefusal(409, "Conflict", ["not_a_proposal"]);
        const at = now().toISOString();
        tx.prepare(
          "UPDATE account_hypothesis SET acceptance = 'accepted', status = 'untested', accepted_by = ?, accepted_at = ?, last_reviewed_at = ?, updated_at = ? WHERE id = ?",
        ).run(actor.userId, at, at, at, id);
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: "human",
            action: "hypothesis.accept",
            entityType: "account_hypothesis",
            entityId: id,
            outcome: "success",
            before: { acceptance: "proposed" },
            after: { acceptance: "accepted", status: "untested" },
            correlationId: actor.correlationId,
          },
          now,
        );
        emitCreated(
          tx,
          { ...actor, actorId: actor.userId, now },
          { hypothesisId: id, accountId: h.account_id, origin: h.origin },
        );
      });
      return this.get(id, now());
    });
  }

  dismiss(actor: HypothesisActor, id: string): HypothesisView {
    const now = actor.now ?? (() => new Date());
    return audited(this.db, actor, "hypothesis.dismiss.refused", id, () => {
      this.requireHuman(actor);
      this.db.transaction((tx) => {
        const h = getHypothesis(tx, id);
        if (!h) throw new HypothesisRefusal(404, "Not found", ["unknown_hypothesis"]);
        if (h.acceptance !== "proposed")
          throw new HypothesisRefusal(409, "Conflict", ["not_a_proposal"]);
        tx.prepare(
          "UPDATE account_hypothesis SET acceptance = 'dismissed', updated_at = ? WHERE id = ?",
        ).run(now().toISOString(), id);
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: "human",
            action: "hypothesis.dismiss",
            entityType: "account_hypothesis",
            entityId: id,
            outcome: "success",
            correlationId: actor.correlationId,
          },
          now,
        );
      });
      return this.get(id, now());
    });
  }

  edit(actor: HypothesisActor, id: string, patch: HypothesisPatch): HypothesisView {
    const now = actor.now ?? (() => new Date());
    return audited(this.db, actor, "hypothesis.edit.refused", id, () => {
      this.requireHuman(actor);
      this.db.transaction((tx) => {
        const h = getHypothesis(tx, id);
        if (!h) throw new HypothesisRefusal(404, "Not found", ["unknown_hypothesis"]);
        if (h.acceptance === "dismissed")
          throw new HypothesisRefusal(409, "Conflict", ["dismissed"]);
        const statement = patch.statement?.trim() ?? h.statement;
        if (patch.statement !== undefined) {
          const c = checkStatement(statement);
          if (!c.ok) throw new HypothesisRefusal(422, "Hypothesis refused", [c.code]);
        }
        this.checkText({
          statement,
          explanation: patch.confidence?.explanation,
          relevance: patch.relevance,
        });
        if (
          patch.category !== undefined &&
          !tx
            .prepare("SELECT 1 FROM hypothesis_category WHERE key = ? AND active = 1")
            .get(patch.category)
        ) {
          throw new HypothesisRefusal(422, "Hypothesis refused", ["unknown_category"]);
        }
        if (patch.confidence && patch.confidence.explanation.trim().length < 3)
          throw new HypothesisRefusal(422, "Hypothesis refused", ["explanation_required"]);
        this.checkRelevance(tx, patch.relevance);
        const at = now().toISOString();
        tx.prepare(
          "UPDATE account_hypothesis SET statement = ?, category = ?, confidence_band = ?, confidence_explanation = ?, updated_at = ? WHERE id = ?",
        ).run(
          statement,
          patch.category ?? h.category,
          patch.confidence?.band ?? h.confidence_band,
          patch.confidence?.explanation.trim() ?? h.confidence_explanation,
          at,
          id,
        );
        if (patch.relevance) this.writeTags(tx, id, patch.relevance);
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: "human",
            action: "hypothesis.edit",
            entityType: "account_hypothesis",
            entityId: id,
            outcome: "success",
            after: { changed: Object.keys(patch) },
            correlationId: actor.correlationId,
          },
          now,
        );
        if (h.status)
          emitUpdated(
            tx,
            { ...actor, actorId: actor.userId, now },
            { hypothesisId: id, accountId: h.account_id, change: "edit", status: h.status },
          );
      });
      return this.get(id, now());
    });
  }

  link(
    actor: HypothesisActor,
    id: string,
    signalId: string,
    role: "supporting" | "contradictory",
  ): HypothesisView {
    const now = actor.now ?? (() => new Date());
    return audited(this.db, actor, "hypothesis.link.refused", id, () => {
      this.requireHuman(actor);
      this.db.transaction((tx) => {
        const h = getHypothesis(tx, id);
        if (!h) throw new HypothesisRefusal(404, "Not found", ["unknown_hypothesis"]);
        if (h.acceptance === "dismissed")
          throw new HypothesisRefusal(409, "Conflict", ["dismissed"]);
        const scope = scopeOf(tx, h.account_id)!;
        this.checkSignals(tx, scope.ids, [signalId]);
        if (
          tx
            .prepare("SELECT 1 FROM hypothesis_evidence WHERE hypothesis_id = ? AND signal_id = ?")
            .get(id, signalId)
        ) {
          throw new HypothesisRefusal(409, "Conflict", ["already_linked"]);
        }
        tx.prepare(
          "INSERT INTO hypothesis_evidence (id, hypothesis_id, signal_id, role, linked_by, linked_by_type, linked_at) VALUES (?,?,?,?,?,'human',?)",
        ).run(uuidv7(), id, signalId, role, actor.userId, now().toISOString());
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: "human",
            action: "hypothesis.link",
            entityType: "account_hypothesis",
            entityId: id,
            outcome: "success",
            after: { role },
            correlationId: actor.correlationId,
          },
          now,
        );
        if (h.status)
          emitUpdated(
            tx,
            { ...actor, actorId: actor.userId, now },
            { hypothesisId: id, accountId: h.account_id, change: "link", status: h.status },
          );
      });
      return this.get(id, now());
    });
  }

  addAssumption(
    actor: HypothesisActor,
    id: string,
    text: string,
    interpretationId?: string,
  ): HypothesisView {
    const now = actor.now ?? (() => new Date());
    return audited(this.db, actor, "hypothesis.edit.refused", id, () => {
      this.requireHuman(actor);
      this.checkText({ text });
      if (text.trim().length < 3 || text.length > 300)
        throw new HypothesisRefusal(422, "Hypothesis refused", ["assumption_length"]);
      this.db.transaction((tx) => {
        const h = getHypothesis(tx, id);
        if (!h) throw new HypothesisRefusal(404, "Not found", ["unknown_hypothesis"]);
        if (h.acceptance === "dismissed")
          throw new HypothesisRefusal(409, "Conflict", ["dismissed"]);
        if (interpretationId) {
          const ok = tx
            .prepare("SELECT account_id FROM problem_interpretation WHERE id = ?")
            .get(interpretationId) as { account_id: string } | undefined;
          if (!ok) throw new HypothesisRefusal(404, "Not found", ["unknown_interpretation"]);
          if (!scopeOf(tx, h.account_id)!.ids.includes(ok.account_id))
            throw new HypothesisRefusal(422, "Hypothesis refused", [
              "interpretation_of_another_account",
            ]);
        }
        tx.prepare(
          "INSERT INTO hypothesis_assumption (id, hypothesis_id, text, source, interpretation_id, added_by, added_at) VALUES (?,?,?,?,?,?,?)",
        ).run(
          uuidv7(),
          id,
          text.trim(),
          interpretationId ? "interpretation" : "analyst",
          interpretationId ?? null,
          actor.userId,
          now().toISOString(),
        );
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: "human",
            action: "hypothesis.edit",
            entityType: "account_hypothesis",
            entityId: id,
            outcome: "success",
            after: { changed: ["assumption"], from_interpretation: Boolean(interpretationId) },
            correlationId: actor.correlationId,
          },
          now,
        );
      });
      return this.get(id, now());
    });
  }

  // ---- reads -----------------------------------------------------------------------------------

  private summary(tx: Tx, h: HypothesisRow, now: Date): HypothesisSummary {
    let effective: HypothesisStatus | null = h.status;
    let flagged = false;
    let reason: string | null = null;
    if (h.acceptance === "accepted" && h.status) {
      const ev = evidenceView(tx, h.id, now);
      if (
        isStaleDue({ status: h.status, anchor: anchorFor(h, ev), now, staleDays: this.staleDays })
      )
        effective = "stale";
      reason = flagReason(ev.events, h.last_reviewed_at ?? h.accepted_at ?? h.created_at);
      flagged = reason !== null;
    }
    return {
      id: h.id,
      accountId: h.account_id,
      acceptance: h.acceptance,
      origin: h.origin,
      statement: h.statement,
      category: h.category,
      status: h.status,
      effectiveStatus: effective,
      confidence: { band: h.confidence_band, explanation: h.confidence_explanation },
      flaggedForReview: flagged,
      flagReason: reason,
      notForPrioritisation: h.not_for_prioritisation === 1,
      label: h.acceptance === "proposed" ? "AI-proposed, not accepted" : "",
    };
  }

  get(id: string, now: Date = this.clock()): HypothesisView {
    return this.db.transaction((tx) => {
      const h = getHypothesis(tx, id);
      if (!h) throw new HttpError(404, "Not found", "Refused: unknown_hypothesis");
      const ref = (signalId: string) => {
        const s = getSignalDetail(tx, signalId, now);
        return {
          signalId,
          observation: s.observation,
          evidenceStatus: s.evidenceStatus,
          reviewStatus: s.reviewStatus,
          isCurrent: s.isCurrent,
          source: { name: s.source.name, ref: s.source.ref },
        };
      };
      const evidence = listEvidence(tx, id);
      const supporting = evidence
        .filter((e) => e.role === "supporting")
        .map((e) => ref(e.signal_id));
      const contradictory = evidence
        .filter((e) => e.role === "contradictory")
        .map((e) => ref(e.signal_id));
      const tags = tx
        .prepare(
          "SELECT dimension, value FROM hypothesis_tag WHERE hypothesis_id = ? ORDER BY value",
        )
        .all(id) as { dimension: string; value: string }[];
      const tag = (d: string) => tags.filter((t) => t.dimension === d).map((t) => t.value);
      return {
        ...this.summary(tx, h, now),
        supporting,
        contradictory,
        buyerConfirmedFacts: supporting.filter((s) => s.evidenceStatus === "buyer_confirmed"),
        assumptions: (
          tx
            .prepare(
              "SELECT text, source, interpretation_id FROM hypothesis_assumption WHERE hypothesis_id = ? ORDER BY added_at, rowid",
            )
            .all(id) as { text: string; source: string; interpretation_id: string | null }[]
        ).map((a) => ({ text: a.text, source: a.source, interpretationId: a.interpretation_id })),
        relevance: { icp: tag("icp"), capability: tag("capability"), offer: tag("offer") },
        dimensions: [],
        statusHistory: listDecisions(tx, id).map((d) => ({
          fromStatus: d.from_status,
          toStatus: d.to_status,
          note: d.note,
          decidedBy: d.decided_by,
          decidedByType: d.decided_by_type,
          reasonCode: d.reason_code,
          decidedAt: d.decided_at,
        })),
        proposedStatement: h.proposed_statement,
        definitions: BAND_DEFINITIONS,
      };
    });
  }

  list(
    accountId: string,
    filter: {
      acceptance?: "accepted" | "proposed" | "dismissed" | undefined;
      status?: string | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    },
    now: Date = this.clock(),
  ) {
    return this.db.transaction((tx) => {
      const scope = scopeOf(tx, accountId);
      if (!scope) throw new HttpError(404, "Not found", "Refused: unknown_account");
      const limit = filter.limit ?? 50;
      const where = [`account_id IN (${scope.ids.map(() => "?").join(",")})`, "acceptance = ?"];
      const params: (string | number)[] = [...scope.ids, filter.acceptance ?? "accepted"];
      if (filter.status) {
        where.push("status = ?");
        params.push(filter.status);
      }
      if (filter.cursor) {
        where.push("id < ?");
        params.push(filter.cursor);
      }
      const rows = tx
        .prepare(
          `SELECT * FROM account_hypothesis WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`,
        )
        .all(...params, limit + 1) as unknown as HypothesisRow[];
      const page = rows.slice(0, limit);
      return {
        items: page.map((h) => this.summary(tx, h, now)),
        nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
      };
    });
  }
}

export interface HypothesisSummary {
  id: string;
  accountId: string;
  acceptance: "proposed" | "accepted" | "dismissed";
  origin: "analyst" | "ai";
  statement: string;
  category: string;
  status: HypothesisStatus | null;
  effectiveStatus: HypothesisStatus | null;
  confidence: { band: "low" | "medium" | "high"; explanation: string };
  flaggedForReview: boolean;
  flagReason: string | null;
  notForPrioritisation: boolean;
  label: string;
}

export interface HypothesisView extends HypothesisSummary {
  supporting: {
    signalId: string;
    observation: string;
    evidenceStatus: string;
    reviewStatus: string;
    isCurrent: boolean;
    source: { name: string; ref: string };
  }[];
  contradictory: HypothesisView["supporting"];
  buyerConfirmedFacts: HypothesisView["supporting"];
  assumptions: { text: string; source: string; interpretationId: string | null }[];
  relevance: { icp: string[]; capability: string[]; offer: string[] };
  dimensions: { dimension: string; band: string; explanation: string }[];
  statusHistory: {
    fromStatus: string | null;
    toStatus: string;
    note: string;
    decidedBy: string | null;
    decidedByType: string;
    reasonCode: string | null;
    decidedAt: string;
  }[];
  proposedStatement: string | null;
  definitions: typeof BAND_DEFINITIONS;
}
