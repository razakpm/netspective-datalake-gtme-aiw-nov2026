import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  formatMicros,
  guardValue,
  normaliseAddress,
  parseMicros,
  validateRunBudget,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { HttpError } from "../../http/errors.js";
import type { JobService } from "../jobs/index.js";
import { recordAudit } from "../audit/index.js";
import { resolveAccountScope } from "../signals/index.js";
import {
  accountFacts,
  accountSpendMicros,
  activeRunFor,
  getRun,
  listFetches,
  listFindings,
  type RunRow,
} from "./repository.js";
import { monthStart, type ResearchActor, type ResearchSettings } from "./settings.js";

// Starting, cancelling and reading research runs (tasks T027; spec FR-001 to FR-008). A run is created
// queued and executed by the worker job (research R-02). Refusals are audited with codes only.

export interface StartInput {
  maxSources?: number | undefined;
  /** Decimal amount such as "1.50"; defaults to the per-run cap. */
  maxCost?: string | undefined;
  sources?: { address: string; capturedText?: string | undefined }[] | undefined;
}

export interface RunView {
  id: string;
  accountId: string;
  state: RunRow["state"];
  trigger: RunRow["trigger"];
  startedBy: string;
  stopReason: string | null;
  icpExcluded: boolean;
  budget: { maxSources: number; maxCost: string };
  totals: {
    sourcesRead: number;
    cost: string;
    inputTokens: number;
    outputTokens: number;
    retries: number;
    injectionFlags: number;
    droppedFindings: {
      uncited: number;
      unsupported: number;
      protectedTopic: number;
      taxonomy: number;
    };
  };
  attention: {
    acknowledgedBy: string | null;
    acknowledgedAt: string | null;
    note: string | null;
  } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export function runView(r: RunRow): RunView {
  return {
    id: r.id,
    accountId: r.account_id,
    state: r.state,
    trigger: r.trigger,
    startedBy: r.started_by,
    stopReason: r.stop_reason,
    icpExcluded: r.icp_excluded === 1,
    budget: { maxSources: r.max_sources, maxCost: formatMicros(r.max_cost_micros) },
    totals: {
      sourcesRead: r.sources_read,
      cost: formatMicros(r.cost_micros),
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      retries: r.retries,
      injectionFlags: r.injection_flags,
      droppedFindings: {
        uncited: r.dropped_uncited,
        unsupported: r.dropped_unsupported,
        protectedTopic: r.dropped_protected,
        taxonomy: r.dropped_taxonomy,
      },
    },
    attention:
      r.state === "needs_attention"
        ? {
            acknowledgedBy: r.attention_ack_by,
            acknowledgedAt: r.attention_ack_at,
            note: r.attention_note,
          }
        : null,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly codes: string[],
    readonly ruleIds: string[] = [],
  ) {
    super(codes.join(", "));
  }
}

export class ResearchService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly jobs: JobService,
    private readonly settings: ResearchSettings,
  ) {}

  private refuse(actor: ResearchActor, action: string, entityId: string | null, e: Refusal): never {
    this.db.transaction((tx) =>
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action,
          entityType: "research_run",
          entityId,
          outcome: "denied",
          after: { codes: e.codes, rule_ids: e.ruleIds },
          correlationId: actor.correlationId,
        },
        actor.now,
      ),
    );
    throw new HttpError(
      e.status,
      e.title,
      e.ruleIds.length
        ? `Rejected by the PHI boundary guard (${e.ruleIds.join(", ")})`
        : `Refused: ${e.codes.join(", ")}`,
      e.ruleIds.length ? { ruleIds: e.ruleIds } : {},
    );
  }

  /** Spend this calendar month and what is left under the per-account cap. */
  accountAllowance(tx: Tx, accountId: string, now: Date): { spent: number; remaining: number } {
    const spent = accountSpendMicros(tx, accountId, monthStart(now));
    return { spent, remaining: Math.max(0, this.settings.accountMonthlyCapMicros - spent) };
  }

  startRun(
    actor: ResearchActor,
    accountId: string,
    input: StartInput,
    trigger: "manual" | "schedule" = "manual",
  ): RunView {
    if (actor.actorType !== "human" && trigger === "manual") {
      throw new HttpError(403, "Forbidden", "Only a person can start a manual run");
    }
    const now = actor.now ?? (() => new Date());
    try {
      const created = this.db.transaction((tx) => {
        const scope = resolveAccountScope(tx, accountId);
        if (!scope) throw new Refusal(404, "Not found", ["unknown_account"]);
        const facts = accountFacts(tx, scope.survivor);
        if (!facts) throw new Refusal(404, "Not found", ["unknown_account"]);

        const maxSources = input.maxSources ?? this.settings.maxSources;
        let maxCostMicros = this.settings.runCapMicros;
        if (input.maxCost !== undefined) {
          const parsed = parseMicros(input.maxCost);
          if (parsed === null) throw new Refusal(400, "Invalid budget", ["max_cost_invalid"]);
          maxCostMicros = parsed;
        }
        const budgetCodes = validateRunBudget(
          { maxSources, maxCostMicros },
          {
            maxSourcesHard: this.settings.maxSourcesHard,
            runCapMicros: this.settings.runCapMicros,
          },
        );
        if (budgetCodes.length) throw new Refusal(422, "Run refused", budgetCodes);

        // Analyst-supplied addresses and pasted text: valid https, guarded, deduplicated.
        const addresses: string[] = [];
        const captured: Record<string, string> = {};
        for (const s of input.sources ?? []) {
          const normalised = normaliseAddress(s.address);
          if (!normalised) throw new Refusal(422, "Run refused", ["invalid_source_address"]);
          const check = guardValue({ address: s.address, text: s.capturedText });
          if (check.decision !== "allow")
            throw new Refusal(422, "Run refused", ["phi_guard"], check.rule_ids);
          if (!addresses.includes(normalised)) addresses.push(normalised);
          if (s.capturedText !== undefined) captured[normalised] = s.capturedText;
        }
        if (addresses.length === 0) for (const d of facts.domains) addresses.push(`https://${d}`);
        if (addresses.length === 0) throw new Refusal(422, "Run refused", ["no_sources"]);

        const allowance = this.accountAllowance(tx, scope.survivor, now());
        if (maxCostMicros > allowance.remaining)
          throw new Refusal(422, "Run refused", ["account_cap_exceeded"]);
        if (activeRunFor(tx, scope.survivor))
          throw new Refusal(409, "Conflict", ["run_already_active"]);

        const id = uuidv7();
        const at = now().toISOString();
        tx.prepare(
          `INSERT INTO research_run (id, account_id, started_by, trigger, state, max_sources, max_cost_micros,
             reserved_micros, icp_excluded, requested_sources, correlation_id, created_at)
           VALUES (?,?,?,?,'queued',?,?,?,?,?,?,?)`,
        ).run(
          id,
          scope.survivor,
          actor.userId ?? "system",
          trigger,
          maxSources,
          maxCostMicros,
          maxCostMicros,
          facts.excluded ? 1 : 0,
          JSON.stringify(addresses),
          actor.correlationId,
          at,
        );
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "research.run.start",
            entityType: "research_run",
            entityId: id,
            outcome: "success",
            after: {
              trigger,
              max_sources: maxSources,
              sources: addresses.length,
              icp_excluded: facts.excluded,
            },
            correlationId: actor.correlationId,
          },
          now,
        );
        return { id, captured };
      });
      this.enqueue(created.id, created.captured, actor);
      return this.get(created.id);
    } catch (error) {
      if (error instanceof Refusal) this.refuse(actor, "research.run.refused", null, error);
      throw error;
    }
  }

  private enqueue(runId: string, captured: Record<string, string>, actor: ResearchActor): void {
    try {
      // Analyst-pasted text travels in the job payload until the job finishes (job retention applies).
      this.jobs.enqueue({
        queue: "research.run",
        idempotencyKey: runId,
        payload: { runId, captured },
        scheduledBy: actor.userId ?? "system",
        correlationId: actor.correlationId,
      });
    } catch (error) {
      this.db.transaction((tx) => {
        tx.prepare(
          "UPDATE research_run SET state = 'failed', stop_reason = 'provider_error', finished_at = ?, reserved_micros = 0 WHERE id = ?",
        ).run((actor.now ?? (() => new Date()))().toISOString(), runId);
      });
      throw error;
    }
  }

  get(id: string): RunView {
    const row = this.db.raw.prepare("SELECT * FROM research_run WHERE id = ?").get(id) as
      RunRow | undefined;
    if (!row) throw new HttpError(404, "Not found", "No such research run");
    return runView(row);
  }

  detail(id: string) {
    return this.db.transaction((tx) => {
      const run = getRun(tx, id);
      if (!run) throw new HttpError(404, "Not found", "No such research run");
      const fetches = listFetches(tx, id);
      const addressOf = new Map(fetches.map((f) => [f.id, f.address]));
      return {
        ...runView(run),
        sources: fetches.map((f) => ({
          id: f.id,
          address: f.address,
          finalAddress: f.final_address,
          outcome: f.outcome,
          contentSha256: f.content_sha256,
          sizeBytes: f.size_bytes,
          truncated: f.truncated === 1,
          flagged: f.flagged === 1,
          injectionRuleIds: JSON.parse(f.injection_rule_ids) as string[],
          permittedExcerpt: f.permitted_excerpt,
          fetchedAt: f.fetched_at,
        })),
        findings: listFindings(tx, id).map((f) => ({
          id: f.id,
          kind: f.kind,
          topic: f.topic,
          statement: f.statement,
          supportingText: f.supporting_text,
          basisFindingIds: JSON.parse(f.basis_finding_ids) as string[],
          extractionConfidence: f.extraction_confidence,
          verified: f.verified === 1,
          carriedOver: f.carried_over_from_run !== null,
          flaggedSource: fetches.find((x) => x.id === f.fetch_id)?.flagged === 1,
          source: f.fetch_id
            ? { fetchId: f.fetch_id, address: addressOf.get(f.fetch_id) ?? "" }
            : null,
          secondSource: f.second_fetch_id
            ? { fetchId: f.second_fetch_id, address: addressOf.get(f.second_fetch_id) ?? "" }
            : null,
          signalId: f.signal_id,
        })),
        summary: run.summary_json ? this.compose(tx, run, run.account_id) : null,
      };
    });
  }

  list(filter: {
    accountId?: string | undefined;
    state?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  }) {
    const limit = filter.limit ?? 50;
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.accountId) {
      const scope = this.db.transaction((tx) => resolveAccountScope(tx, filter.accountId!));
      if (!scope) throw new HttpError(404, "Not found", "No such account");
      where.push(`account_id IN (${scope.ids.map(() => "?").join(",")})`);
      params.push(...scope.ids);
    }
    if (filter.state) {
      where.push("state = ?");
      params.push(filter.state);
    }
    if (filter.cursor) {
      where.push("id < ?");
      params.push(filter.cursor);
    }
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM research_run ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`,
      )
      .all(...params, limit + 1) as unknown as RunRow[];
    const page = rows.slice(0, limit);
    return {
      items: page.map(runView),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  /** The account's current research picture: the latest completed or budget-stopped run's verified summary. */
  accountSummary(accountId: string) {
    return this.db.transaction((tx) => {
      const scope = resolveAccountScope(tx, accountId);
      if (!scope) throw new HttpError(404, "Not found", "No such account");
      const run = tx
        .prepare(
          `SELECT * FROM research_run WHERE account_id IN (${scope.ids.map(() => "?").join(",")})
             AND state IN ('completed','budget_reached') AND summary_json IS NOT NULL ORDER BY id DESC LIMIT 1`,
        )
        .get(...scope.ids) as RunRow | undefined;
      if (!run) {
        return {
          accountId: scope.survivor,
          runId: null,
          label: "AI-generated, advisory" as const,
          facts: [],
          inferences: [],
          unknowns: [],
          contradictions: [],
          sources: [],
          modelAndPrompt: null,
        };
      }
      return this.compose(tx, run, scope.survivor);
    });
  }

  /** One run's stored summary in the response shape, with sources resolved to addresses. */
  private compose(tx: Tx, run: RunRow, accountId: string) {
    const summary = JSON.parse(run.summary_json!) as {
      facts: { key: string; carriedOver: boolean }[];
      inferences: { key: string }[];
      unknowns: { topic: string; statement: string }[];
      contradictions: { key: string }[];
      sources: { fetchId: string; flagged: boolean }[];
    };
    const fetches = tx
      .prepare(
        "SELECT id, address, flagged FROM research_source_fetch WHERE id IN (SELECT fetch_id FROM research_finding WHERE fetch_id IS NOT NULL) OR run_id = ?",
      )
      .all(run.id) as { id: string; address: string; flagged: number }[];
    const address = new Map(fetches.map((f) => [f.id, f.address]));
    const flagged = new Set(fetches.filter((f) => f.flagged === 1).map((f) => f.id));
    const finding = (id: string, carried: boolean) => {
      const f = tx.prepare("SELECT * FROM research_finding WHERE id = ?").get(id) as
        | {
            id: string;
            kind: string;
            topic: string;
            statement: string;
            supporting_text: string | null;
            basis_finding_ids: string;
            extraction_confidence: string;
            verified: number;
            fetch_id: string | null;
            second_fetch_id: string | null;
            signal_id: string | null;
          }
        | undefined;
      if (!f) return null;
      const src = (fid: string | null) =>
        fid ? { fetchId: fid, address: address.get(fid) ?? "" } : null;
      return {
        id: f.id,
        kind: f.kind,
        topic: f.topic,
        statement: f.statement,
        supportingText: f.supporting_text,
        basisFindingIds: JSON.parse(f.basis_finding_ids) as string[],
        extractionConfidence: f.extraction_confidence,
        verified: f.verified === 1,
        carriedOver: carried,
        flaggedSource: f.fetch_id ? flagged.has(f.fetch_id) : false,
        source: src(f.fetch_id),
        secondSource: src(f.second_fetch_id),
        signalId: f.signal_id,
      };
    };
    const model = tx
      .prepare(
        "SELECT model FROM ai_invocation WHERE context_type = 'research_run' AND context_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(run.id) as { model: string } | undefined;
    return {
      accountId,
      runId: run.id,
      label: "AI-generated, advisory" as const,
      facts: summary.facts.map((f) => finding(f.key, f.carriedOver)).filter((x) => x !== null),
      inferences: summary.inferences.map((f) => finding(f.key, false)).filter((x) => x !== null),
      unknowns: summary.unknowns,
      contradictions: summary.contradictions
        .map((f) => finding(f.key, false))
        .filter((x) => x !== null),
      sources: summary.sources.map((s) => ({
        fetchId: s.fetchId,
        address: address.get(s.fetchId) ?? "",
        flagged: s.flagged,
      })),
      modelAndPrompt: model
        ? { model: model.model, promptVersion: "research-extract@1.0.0" }
        : null,
    };
  }

  cancel(actor: ResearchActor, id: string): RunView {
    const now = actor.now ?? (() => new Date());
    this.db.transaction((tx) => {
      const run = getRun(tx, id);
      if (!run) throw new HttpError(404, "Not found", "No such research run");
      if (run.state !== "queued" && run.state !== "running") {
        throw new HttpError(409, "Conflict", "Only a queued or running run can be cancelled");
      }
      tx.prepare(
        `UPDATE research_run SET state = 'cancelled', stop_reason = 'cancelled', finished_at = ?, reserved_micros = 0,
           cost_micros = (SELECT COALESCE(SUM(cost_micros),0) FROM ai_invocation WHERE context_type = 'research_run' AND context_id = ?)
         WHERE id = ?`,
      ).run(now().toISOString(), id, id);
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "research.run.cancel",
          entityType: "research_run",
          entityId: id,
          outcome: "success",
          before: { state: run.state },
          correlationId: actor.correlationId,
        },
        now,
      );
    });
    return this.get(id);
  }

  acknowledge(actor: ResearchActor, id: string, note: string): RunView {
    const now = actor.now ?? (() => new Date());
    const guard = guardValue({ note });
    if (guard.decision !== "allow")
      this.refuse(
        actor,
        "research.run.refused",
        id,
        new Refusal(422, "Refused", ["phi_guard"], guard.rule_ids),
      );
    this.db.transaction((tx) => {
      const run = getRun(tx, id);
      if (!run) throw new HttpError(404, "Not found", "No such research run");
      if (run.state !== "needs_attention")
        throw new HttpError(409, "Conflict", "The run is not waiting for attention");
      if (run.attention_ack_at)
        throw new HttpError(409, "Conflict", "The run was already acknowledged");
      tx.prepare(
        "UPDATE research_run SET attention_ack_by = ?, attention_ack_at = ?, attention_note = ? WHERE id = ?",
      ).run(actor.userId, now().toISOString(), note.trim(), id);
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "research.run.attention.ack",
          entityType: "research_run",
          entityId: id,
          outcome: "success",
          correlationId: actor.correlationId,
        },
        now,
      );
    });
    return this.get(id);
  }
}
