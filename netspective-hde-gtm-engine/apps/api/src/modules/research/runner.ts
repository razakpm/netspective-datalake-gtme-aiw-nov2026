import { createHash } from "node:crypto";
import { PROMPTS, type ExtractedFinding } from "@gtm/ai-contracts";
import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  guardValue,
  matchApprovedRule,
  normaliseAddress,
  scanForInjection,
  verifyFindings,
  type VerifiableFinding,
  type VerifiedFinding,
  type VerifierSource,
} from "@gtm/domain";
import { guardedCall, type ResearchSourceProvider } from "@gtm/providers";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit/index.js";
import { LlmGateway, buildModelInput } from "../providers/index.js";
import { listSignals, type SignalService } from "../signals/index.js";
import { emitResearched } from "./events.js";
import { handOffSignals, type HandoffSource } from "./handoff.js";
import {
  accountFacts,
  accountSpendMicros,
  getRun,
  latestProcessedFetch,
  listEnabledRules,
  type RuleRow,
  type RunRow,
} from "./repository.js";
import { monthStart, type ResearchSettings } from "./settings.js";
import { assembleSummary, type SummaryFinding } from "./summary.js";

// The research runner (tasks T028, T036, T039; spec FR-001 to FR-015, FR-035/FR-036). It fetches approved
// sources only, records every attempt, guards and scans each page, skips unchanged pages, calls the gateway,
// verifies the model's findings, hands signals to feature 003 and stores a deterministic summary. It stops
// before any step that would exceed the budget.

const CHUNK_CHARS = 60_000;

export interface RunnerDeps {
  db: SqliteDatabase;
  source: ResearchSourceProvider;
  gateway: LlmGateway;
  signals: SignalService;
  settings: ResearchSettings;
  now?: () => Date;
  /** Hook for AI hypothesis proposals (feature 004 phase 7). */
  proposer?: HypothesisProposer | undefined;
}

export interface HypothesisProposer {
  propose(ctx: {
    run: RunRow;
    accountId: string;
    kept: readonly VerifiedFinding[];
    findingIds: ReadonlyMap<string, string>;
    signalIds: ReadonlyMap<string, string>;
    excluded: boolean;
  }): Promise<{ proposed: number; failed?: boolean }>;
}

interface ProcessedSource {
  fetchId: string;
  address: string;
  host: string;
  text: string;
  flagged: boolean;
  ruleKind: string;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const normaliseText = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

export class ResearchRunner {
  private readonly now: () => Date;
  constructor(private readonly d: RunnerDeps) {
    this.now = d.now ?? (() => new Date());
  }

  private run(id: string): RunRow | undefined {
    return this.d.db.raw.prepare("SELECT * FROM research_run WHERE id = ?").get(id) as
      RunRow | undefined;
  }
  private cancelled(id: string): boolean {
    return this.run(id)?.state === "cancelled";
  }

  private syncCost(tx: Tx, runId: string): void {
    tx.prepare(
      `UPDATE research_run SET
         cost_micros = (SELECT COALESCE(SUM(cost_micros),0) FROM ai_invocation WHERE context_type = 'research_run' AND context_id = ?),
         input_tokens = (SELECT COALESCE(SUM(input_tokens),0) FROM ai_invocation WHERE context_type = 'research_run' AND context_id = ?),
         output_tokens = (SELECT COALESCE(SUM(output_tokens),0) FROM ai_invocation WHERE context_type = 'research_run' AND context_id = ?),
         retries = (SELECT COALESCE(SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END),0) FROM ai_invocation WHERE context_type = 'research_run' AND context_id = ?)
       WHERE id = ?`,
    ).run(runId, runId, runId, runId, runId);
  }

  private audit(
    tx: Tx,
    run: RunRow,
    action: string,
    outcome: "success" | "denied" | "failed",
    after?: unknown,
    entityId?: string,
  ): void {
    recordAudit(
      tx,
      {
        actorId: null,
        actorType: "system",
        action,
        entityType: entityId ? "research_source_fetch" : "research_run",
        entityId: entityId ?? run.id,
        outcome,
        after,
        correlationId: run.correlation_id,
      },
      this.now,
    );
  }

  private insertFetch(
    tx: Tx,
    run: RunRow,
    row: {
      address: string;
      normalised: string;
      finalAddress?: string | null;
      ruleId?: string | null;
      outcome: string;
      status?: number | null;
      sha?: string | null;
      size?: number | null;
      truncated?: boolean;
      ruleIds?: string[];
      flagged?: boolean;
    },
  ): string {
    const id = uuidv7();
    tx.prepare(
      `INSERT INTO research_source_fetch (id, run_id, address, address_normalised, final_address, rule_id, outcome, http_status,
         content_sha256, size_bytes, truncated, injection_rule_ids, flagged, permitted_excerpt, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,
    ).run(
      id,
      run.id,
      row.address,
      row.normalised,
      row.finalAddress ?? null,
      row.ruleId ?? null,
      row.outcome,
      row.status ?? null,
      row.sha ?? null,
      row.size ?? null,
      row.truncated ? 1 : 0,
      JSON.stringify(row.ruleIds ?? []),
      row.flagged ? 1 : 0,
      this.now().toISOString(),
    );
    return id;
  }

  private finish(
    runId: string,
    state: "completed" | "budget_reached" | "needs_attention" | "failed",
    stop: RunRow["stop_reason"],
    extra: {
      summaryJson?: string;
      dropped?: { uncited: number; unsupported: number; protectedTopic: number; taxonomy: number };
      sourcesRead?: number;
      injectionFlags?: number;
      promptVersionId?: string;
    } = {},
  ): void {
    this.d.db.transaction((tx) => {
      const current = getRun(tx, runId);
      if (!current || current.state === "cancelled") return;
      tx.prepare(
        `UPDATE research_run SET state = ?, stop_reason = ?, finished_at = ?, reserved_micros = 0, summary_json = COALESCE(?, summary_json),
           summary_prompt_version_id = COALESCE(?, summary_prompt_version_id),
           dropped_uncited = ?, dropped_unsupported = ?, dropped_protected = ?, dropped_taxonomy = ?,
           sources_read = COALESCE(?, sources_read), injection_flags = COALESCE(?, injection_flags)
         WHERE id = ?`,
      ).run(
        state,
        stop ?? null,
        this.now().toISOString(),
        extra.summaryJson ?? null,
        extra.promptVersionId ?? null,
        extra.dropped?.uncited ?? 0,
        extra.dropped?.unsupported ?? 0,
        extra.dropped?.protectedTopic ?? 0,
        extra.dropped?.taxonomy ?? 0,
        extra.sourcesRead ?? null,
        extra.injectionFlags ?? null,
        runId,
      );
      this.syncCost(tx, runId);
    });
  }

  /** Execute a queued run. Idempotent: a run that is no longer queued is left alone. */
  async execute(runId: string, captured: Record<string, string> = {}): Promise<void> {
    const started = this.d.db.transaction((tx) => {
      const run = getRun(tx, runId);
      if (!run || run.state !== "queued") return null;
      tx.prepare("UPDATE research_run SET state = 'running', started_at = ? WHERE id = ?").run(
        this.now().toISOString(),
        runId,
      );
      return getRun(tx, runId)!;
    });
    if (!started) return;
    const run = started;

    const facts = this.d.db.transaction((tx) => accountFacts(tx, run.account_id));
    if (!facts) {
      this.finish(runId, "failed", "provider_error");
      return;
    }
    const rules = this.d.db.transaction((tx) => listEnabledRules(tx));
    const requested = JSON.parse(run.requested_sources) as string[];

    // ---- fetch phase -------------------------------------------------------------------------------
    const processed: ProcessedSource[] = [];
    const sourcesForVerify: VerifierSource[] = [];
    const flaggedFetch = new Set<string>();
    const readFetchIds: string[] = [];
    const seen = new Set<string>();
    let sourcesRead = 0;
    let injectionFlags = 0;
    let stop: RunRow["stop_reason"] = null;

    for (let i = 0; i < requested.length; i++) {
      if (this.cancelled(runId)) return;
      const address = requested[i]!;
      const normalised = normaliseAddress(address) ?? address;
      if (stop === "max_sources" || sourcesRead >= run.max_sources) {
        stop = "max_sources";
        this.d.db.transaction((tx) =>
          this.insertFetch(tx, run, { address, normalised, outcome: "budget_skipped" }),
        );
        continue;
      }
      if (seen.has(normalised)) {
        this.d.db.transaction((tx) =>
          this.insertFetch(tx, run, { address, normalised, outcome: "duplicate_in_run" }),
        );
        continue;
      }
      seen.add(normalised);
      const rule: RuleRow | null = matchApprovedRule(
        address,
        rules.map((r) => ({ ...r, matchType: r.match_type })),
      )
        ? (rules.find((r) => matchApprovedRule(address, [{ ...r, matchType: r.match_type }])) ??
          null)
        : null;
      if (!rule) {
        this.d.db.transaction((tx) => {
          this.insertFetch(tx, run, { address, normalised, outcome: "refused_unapproved" });
          this.audit(tx, run, "research.source.refused", "denied", { reason: "not_approved" });
        });
        continue;
      }
      const isApproved = (a: string) =>
        matchApprovedRule(
          a,
          rules.map((r) => ({ ...r, matchType: r.match_type })),
        ) !== null;
      const fetched = await guardedCall({
        provider: this.d.source.name,
        operation: "fetch",
        correlationId: run.correlation_id,
        payload: { address },
        call: () =>
          this.d.source.fetch({
            address,
            capturedText: captured[normalised] ?? captured[address],
            maxBytes: this.d.settings.maxPageBytes,
            timeoutMs: this.d.settings.fetchTimeoutMs,
            isApproved,
          }),
      });
      sourcesRead += 1;
      if (!fetched.ok) {
        const code = fetched.error.code;
        const outcome =
          code === "redirect_not_approved"
            ? "refused_redirect"
            : code === "blocked_address" || code === "phi_blocked"
              ? "refused_unapproved"
              : "unreachable";
        this.d.db.transaction((tx) => {
          this.insertFetch(tx, run, { address, normalised, ruleId: rule.id, outcome });
          if (outcome !== "unreachable")
            this.audit(tx, run, "research.source.refused", "denied", { reason: code });
        });
        continue;
      }
      const page = fetched.value;
      const text = page.text;
      const guard = guardValue(text);
      if (guard.decision !== "allow") {
        // Blocked before any model sees it: nothing stored, rule ids only in the audit event.
        this.d.db.transaction((tx) => {
          const fid = this.insertFetch(tx, run, {
            address,
            normalised,
            finalAddress: page.finalAddress,
            ruleId: rule.id,
            outcome: "blocked_by_guard",
            status: page.status,
          });
          this.audit(
            tx,
            run,
            "research.source.blocked",
            "denied",
            { rule_ids: guard.rule_ids },
            fid,
          );
        });
        continue;
      }
      const hits = scanForInjection(text);
      const flagged = hits.length > 0;
      const sha256 = sha(normaliseText(text));
      const cached = this.d.db.transaction((tx) =>
        latestProcessedFetch(tx, run.account_id, normalised),
      );
      const unchanged = cached?.content_sha256 === sha256;
      const outcome = unchanged
        ? "unchanged_skipped"
        : page.truncated
          ? "too_large_truncated"
          : "processed";
      const fetchId = this.d.db.transaction((tx) => {
        const fid = this.insertFetch(tx, run, {
          address,
          normalised,
          finalAddress: page.finalAddress,
          ruleId: rule.id,
          outcome,
          status: page.status,
          sha: sha256,
          size: page.sizeBytes,
          truncated: page.truncated,
          ruleIds: hits.map((h) => h.ruleId),
          flagged,
        });
        if (flagged) {
          this.audit(
            tx,
            run,
            "research.source.flagged",
            "success",
            { rule_ids: hits.map((h) => h.ruleId) },
            fid,
          );
          tx.prepare(
            "UPDATE research_run SET injection_flags = injection_flags + 1 WHERE id = ?",
          ).run(run.id);
        }
        tx.prepare("UPDATE research_run SET sources_read = ? WHERE id = ?").run(
          sourcesRead,
          run.id,
        );
        return fid;
      });
      if (flagged) {
        injectionFlags += 1;
        flaggedFetch.add(fetchId);
      }
      readFetchIds.push(fetchId);
      if (!unchanged) {
        const host = new URL(page.finalAddress).hostname;
        processed.push({
          fetchId,
          address: normalised,
          host,
          text,
          flagged,
          ruleKind: rule.signal_source_kind,
        });
        sourcesForVerify.push({ fetchId, address: normalised, text, read: true });
      }
    }
    if (this.cancelled(runId)) return;

    // ---- extraction phase --------------------------------------------------------------------------
    const taxonomy = this.d.db.raw
      .prepare(
        "SELECT key FROM signal_type WHERE status = 'active' AND taxonomy_version = (SELECT version FROM taxonomy_version WHERE status = 'current') ORDER BY key",
      )
      .all() as { key: string }[];
    const observations = this.d.db.transaction((tx) =>
      listSignals(
        tx,
        { accountId: run.account_id, currentOnly: true, limit: 20 },
        this.now(),
      ).items.map((s) => ({ id: s.id, text: s.observation })),
    );
    const prompt = PROMPTS.find((p) => p.name === "research-extract")!;
    const promptRow = this.d.db.raw
      .prepare("SELECT id FROM prompt_version WHERE name = ? AND version = ?")
      .get(prompt.name, prompt.version) as { id: string };

    const chunks: ProcessedSource[][] = [];
    let current: ProcessedSource[] = [];
    let size = 0;
    for (const s of processed) {
      if (current.length && size + s.text.length > CHUNK_CHARS) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(s);
      size += s.text.length;
    }
    if (current.length) chunks.push(current);

    const findings: { finding: ExtractedFinding; chunk: number }[] = [];
    let model = "";
    for (let c = 0; c < chunks.length; c++) {
      if (this.cancelled(runId)) return;
      const chunk = chunks[c]!;
      const result = await this.d.gateway.call({
        task: "extraction",
        promptName: "research-extract",
        modelInput: buildModelInput({
          account: { name: facts.name, type: facts.orgType, domain: facts.domains[0] },
          sources: chunk.map((s) => ({ id: s.fetchId, label: "source", text: s.text })),
          signalObservations: observations,
          reference: {
            signalTypeKeys: taxonomy.map((t) => t.key),
            categoryKeys: [],
            capabilityKeys: [],
          },
        }),
        contextType: "research_run",
        contextId: runId,
        accountId: run.account_id,
        runCapMicros: run.max_cost_micros,
        accountRemaining: () =>
          Math.max(
            0,
            this.d.settings.accountMonthlyCapMicros -
              this.d.db.transaction((tx) =>
                accountSpendMicros(tx, run.account_id, monthStart(this.now())),
              ),
          ),
        actor: { id: null, type: "ai" },
        correlationId: run.correlation_id,
      });
      this.d.db.transaction((tx) => this.syncCost(tx, runId));
      if (!result.ok) {
        if (result.code === "budget_refused") {
          const accountLeft =
            this.d.settings.accountMonthlyCapMicros -
            this.d.db.transaction((tx) =>
              accountSpendMicros(tx, run.account_id, monthStart(this.now())),
            );
          stop =
            accountLeft < run.max_cost_micros - (this.run(runId)?.cost_micros ?? 0)
              ? "account_cap"
              : "max_cost";
          break;
        }
        if (
          result.code === "invalid_output" ||
          result.code === "provider_error" ||
          result.code === "phi_blocked"
        ) {
          this.d.db.transaction((tx) => {
            this.audit(tx, run, "research.run.attention", "failed", {
              reason: result.code,
              attempts: result.attempts,
            });
          });
          this.finish(
            runId,
            "needs_attention",
            result.code === "provider_error" ? "provider_error" : "invalid_output",
            { sourcesRead, injectionFlags },
          );
          return;
        }
        this.finish(runId, "failed", "provider_error", { sourcesRead, injectionFlags });
        return;
      }
      model = this.d.gateway.modelName("extraction");
      for (const f of (result.data as { findings: ExtractedFinding[] }).findings)
        findings.push({ finding: f, chunk: c });
    }
    if (this.cancelled(runId)) return;

    // ---- verification, storage, hand-off, summary --------------------------------------------------
    const allowedTypeKeys = new Set(taxonomy.map((t) => t.key));
    const namespaced: VerifiableFinding[] = findings.map(({ finding, chunk }) => ({
      ...finding,
      key: `c${chunk}.${finding.key}`,
      basisKeys: finding.basisKeys?.map((k) => `c${chunk}.${k}`),
    }));
    const verified = verifyFindings({
      findings: namespaced,
      sources: sourcesForVerify,
      allowedTypeKeys,
      account: { name: facts.name, domains: facts.domains },
    });

    // Statements and quotes pass the PHI guard before they are stored (data-model: research_finding).
    const stored: VerifiedFinding[] = [];
    let guardDropped = 0;
    for (const k of verified.kept) {
      const check = guardValue({ s: k.statement, q: k.supportingText });
      if (check.decision !== "allow") guardDropped += 1;
      else stored.push(k);
    }
    const dropped = {
      ...verified.dropped,
      unsupported: verified.dropped.unsupported + guardDropped,
    };

    const findingIds = new Map<string, string>();
    this.d.db.transaction((tx) => {
      for (const k of stored) {
        const id = uuidv7();
        findingIds.set(k.key, id);
        // An inference carries the source of the first finding it rests on.
        const fetchOf = (x: VerifiedFinding): string | null => {
          if (x.sourceFetchId) return x.sourceFetchId;
          for (const b of x.basisKeys) {
            const base = stored.find((s) => s.key === b);
            const f = base ? fetchOf(base) : null;
            if (f) return f;
          }
          return null;
        };
        tx.prepare(
          `INSERT INTO research_finding (id, run_id, fetch_id, kind, topic, statement, supporting_text, supporting_text_sha256,
             basis_finding_ids, second_fetch_id, type_key, extraction_confidence, verified, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          runId,
          fetchOf(k),
          k.kind,
          k.topic,
          k.statement,
          k.supportingText,
          k.supportingTextSha256,
          "[]",
          k.secondSourceFetchId,
          k.typeKey,
          k.confidence,
          k.verified ? 1 : 0,
          this.now().toISOString(),
        );
      }
      // Basis references now that every finding has an id.
      for (const k of stored) {
        if (k.basisKeys.length === 0) continue;
        const ids = k.basisKeys
          .map((b) => findingIds.get(b))
          .filter((x): x is string => Boolean(x));
        tx.prepare("UPDATE research_finding SET basis_finding_ids = ? WHERE id = ?").run(
          JSON.stringify(ids),
          findingIds.get(k.key)!,
        );
      }
      for (const k of stored) {
        const fid = findingIds.get(k.key)!;
        const assess = (dimension: string, band: string, explanation: string) =>
          tx
            .prepare(
              `INSERT INTO confidence_assessment (id, subject_type, subject_id, dimension, band, explanation, assessed_by_type, assessed_at)
             VALUES (?,?,?,?,?,?,?,?)`,
            )
            .run(
              uuidv7(),
              "finding",
              fid,
              dimension,
              band,
              explanation,
              "system",
              this.now().toISOString(),
            );
        assess(
          "extraction",
          k.confidence,
          "Extraction confidence as stated for this finding, capped by the entity-match check.",
        );
        if (k.sourceFetchId) {
          assess(
            "entity_match",
            verified.entityMatch[k.sourceFetchId] ?? "low",
            "The page names the account or one of its known domains.",
          );
        }
      }
      const drops =
        dropped.uncited + dropped.unsupported + dropped.protectedTopic + dropped.taxonomy;
      if (drops > 0) this.audit(tx, run, "research.finding.dropped", "success", { ...dropped });
    });

    const handoff = handOffSignals(
      this.d.signals,
      {
        accountId: run.account_id,
        model: model || this.d.gateway.modelName("extraction"),
        promptVersion: `${prompt.name}@${prompt.version}`,
        correlationId: run.correlation_id,
        now: this.now,
        sourceFor: (fetchId): HandoffSource | undefined => {
          const p = processed.find((x) => x.fetchId === fetchId);
          return p ? { address: p.address, host: p.host, signalSourceKind: p.ruleKind } : undefined;
        },
        firstFetchOf: (f, byKey) => {
          if (f.sourceFetchId) return f.sourceFetchId;
          for (const b of f.basisKeys) {
            const base = byKey.get(b);
            if (base?.sourceFetchId) return base.sourceFetchId;
          }
          return null;
        },
      },
      stored,
    );
    const signalIds = new Map<string, string>();
    this.d.db.transaction((tx) => {
      for (const h of handoff) {
        tx.prepare(
          "UPDATE research_finding SET signal_id = ?, signal_refusal_codes = ? WHERE id = ?",
        ).run(h.signalId, JSON.stringify(h.refusalCodes), findingIds.get(h.key)!);
        if (h.signalId) signalIds.set(h.key, h.signalId);
      }
      this.audit(tx, run, "research.signal.handoff", "success", {
        signals: handoff.filter((h) => h.signalId).length,
        created: handoff.filter((h) => h.created).length,
        refused: handoff.filter((h) => !h.signalId).length,
      });
    });

    // Source reliability assessments follow the signal's reliability (feature 003, by rule).
    this.d.db.transaction((tx) => {
      for (const [key, signalId] of signalIds) {
        const rel = tx.prepare("SELECT reliability FROM signal WHERE id = ?").get(signalId) as
          { reliability: string } | undefined;
        const band =
          rel?.reliability === "high" ? "high" : rel?.reliability === "medium" ? "medium" : "low";
        tx.prepare(
          `INSERT INTO confidence_assessment (id, subject_type, subject_id, dimension, band, explanation, assessed_by_type, assessed_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        ).run(
          uuidv7(),
          "finding",
          findingIds.get(key)!,
          "source_reliability",
          band,
          "From the reliability of the linked signal, which follows its source kind.",
          "system",
          this.now().toISOString(),
        );
      }
    });

    // Carried-over findings from sources skipped as unchanged.
    const carried = this.carriedOver(run, readFetchIds);
    const summaryFindings: SummaryFinding[] = [
      ...stored
        .filter((k) => k.kind === "fact" || k.kind === "inference" || k.kind === "contradiction")
        .map((k) => ({
          id: findingIds.get(k.key)!,
          key: k.key,
          kind: k.kind as "fact" | "inference" | "contradiction",
          topic: k.topic,
          statement: k.statement,
          supportingText: k.supportingText,
          sourceFetchId: k.sourceFetchId,
          secondSourceFetchId: k.secondSourceFetchId,
          basisIds: k.basisKeys
            .map((b) => findingIds.get(b))
            .filter((x): x is string => Boolean(x)),
          confidence: k.confidence,
          carriedOver: false,
        })),
      ...carried,
    ];
    const summary = assembleSummary({
      findings: summaryFindings,
      modelUnknowns: verified.unknowns,
      sources: readFetchIds.map((id) => ({ fetchId: id, flagged: flaggedFetch.has(id) })),
    });
    const state: "completed" | "budget_reached" = stop ? "budget_reached" : "completed";
    const signalsCreated = handoff.filter((h) => h.created).length;
    this.d.db.transaction((tx) => {
      this.audit(tx, run, "research.summary.store", "success", {
        facts: summary.facts.length,
        inferences: summary.inferences.length,
        unknowns: summary.unknowns.length,
        contradictions: summary.contradictions.length,
      });
    });
    this.finish(runId, state, stop, {
      summaryJson: JSON.stringify(summary),
      dropped,
      sourcesRead,
      injectionFlags,
      promptVersionId: promptRow.id,
    });

    // Optional hypothesis proposals (a second gateway call); a failure there never undoes the summary.
    if (this.d.proposer) {
      try {
        await this.d.proposer.propose({
          run: this.run(runId)!,
          accountId: run.account_id,
          kept: stored,
          findingIds,
          signalIds,
          excluded: facts.excluded,
        });
      } catch {
        /* proposals are optional */
      }
    }

    this.d.db.transaction((tx) => {
      const final = getRun(tx, runId)!;
      if (final.state === "cancelled") return;
      this.audit(
        tx,
        final,
        state === "completed" ? "research.run.complete" : "research.run.budget_reached",
        "success",
        { cost_micros: final.cost_micros, sources_read: final.sources_read },
      );
      emitResearched(
        tx,
        { actorId: null, actorType: "system", correlationId: final.correlation_id, now: this.now },
        {
          runId,
          accountId: run.account_id,
          state,
          signalsCreated,
          injectionFlags: final.injection_flags,
          costMicros: final.cost_micros,
        },
      );
    });
  }

  /** Facts and inferences from the previous processed fetch of each unchanged source, marked carried over. */
  private carriedOver(run: RunRow, readFetchIds: readonly string[]): SummaryFinding[] {
    const out: SummaryFinding[] = [];
    this.d.db.transaction((tx) => {
      const skipped = tx
        .prepare(
          "SELECT id, address_normalised, content_sha256 FROM research_source_fetch WHERE run_id = ? AND outcome = 'unchanged_skipped'",
        )
        .all(run.id) as { id: string; address_normalised: string }[];
      for (const s of skipped) {
        if (!readFetchIds.includes(s.id)) continue;
        const prev = latestProcessedFetch(tx, run.account_id, s.address_normalised);
        // `latestProcessedFetch` returns the newest processed fetch (before this run's skip row).
        if (!prev) continue;
        const rows = tx
          .prepare(
            "SELECT * FROM research_finding WHERE fetch_id = ? AND kind IN ('fact','inference','contradiction')",
          )
          .all(prev.id) as {
          id: string;
          kind: "fact" | "inference" | "contradiction";
          topic: string;
          statement: string;
          supporting_text: string | null;
          fetch_id: string | null;
          second_fetch_id: string | null;
          basis_finding_ids: string;
          extraction_confidence: "low" | "medium" | "high";
          run_id: string;
        }[];
        for (const r of rows) {
          out.push({
            id: r.id,
            key: r.id,
            kind: r.kind,
            topic: r.topic,
            statement: r.statement,
            supportingText: r.supporting_text,
            sourceFetchId: s.id,
            secondSourceFetchId: r.second_fetch_id,
            basisIds: JSON.parse(r.basis_finding_ids) as string[],
            confidence: r.extraction_confidence,
            carriedOver: true,
          });
        }
      }
    });
    return out;
  }
}
