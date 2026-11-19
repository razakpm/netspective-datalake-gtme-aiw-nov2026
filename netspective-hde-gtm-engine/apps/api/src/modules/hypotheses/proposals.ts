import { AccountHypothesisProposalsSchema, PROMPTS } from "@gtm/ai-contracts";
import type { SqliteDatabase } from "@gtm/db";
import { checkStatement, guardValue } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit/index.js";
import { LlmGateway, buildModelInput } from "../providers/index.js";
import type { HypothesisProposer } from "../research/index.js";

// AI hypothesis proposals from a run (task T044; spec FR-023). A second, larger-model gateway call turns the
// verified findings into proposals. Each proposal must rest on at least one signal this run produced, pass the
// statement rule and the PHI guard, and use a known category; otherwise it is dropped and counted. Proposals
// are stored as proposals (no status) until an analyst accepts them.

export class HypothesisProposals implements HypothesisProposer {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly gateway: LlmGateway,
    private readonly accountRemaining: (accountId: string) => number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async propose(
    ctx: Parameters<HypothesisProposer["propose"]>[0],
  ): Promise<{ proposed: number; failed?: boolean }> {
    const plain = (k: string) => k.replace(/^c\d+\./, "");
    const keyOf = new Map<string, string>(); // plain key -> signal id
    const observations: { id: string; text: string }[] = [];
    for (const k of ctx.kept) {
      const signalId = ctx.signalIds.get(k.key);
      if (!signalId || keyOf.has(plain(k.key))) continue;
      keyOf.set(plain(k.key), signalId);
      observations.push({ id: plain(k.key), text: k.statement });
    }
    if (observations.length === 0) return { proposed: 0 };
    const facts = this.db.raw
      .prepare("SELECT name FROM account WHERE id = ?")
      .get(ctx.accountId) as { name: string };
    const type =
      (
        this.db.raw
          .prepare(
            "SELECT org_type FROM account_classification WHERE account_id = ? ORDER BY rowid DESC LIMIT 1",
          )
          .get(ctx.accountId) as { org_type: string } | undefined
      )?.org_type ?? "unknown";
    const categories = (
      this.db.raw
        .prepare("SELECT key FROM hypothesis_category WHERE active = 1 ORDER BY key")
        .all() as { key: string }[]
    ).map((c) => c.key);
    const capabilities = (
      this.db.raw
        .prepare("SELECT key FROM service_capability_provisional WHERE active = 1 ORDER BY key")
        .all() as { key: string }[]
    ).map((c) => c.key);
    const result = await this.gateway.call({
      task: "synthesis",
      promptName: "hypothesis-propose",
      modelInput: buildModelInput({
        account: { name: facts.name, type },
        sources: [],
        signalObservations: observations,
        reference: { signalTypeKeys: [], categoryKeys: categories, capabilityKeys: capabilities },
      }),
      contextType: "research_run",
      contextId: ctx.run.id,
      runCapMicros: ctx.run.max_cost_micros,
      accountRemaining: () => this.accountRemaining(ctx.accountId),
      actor: { id: null, type: "ai" },
      correlationId: ctx.run.correlation_id,
    });
    this.db.transaction((tx) =>
      tx
        .prepare(
          `UPDATE research_run SET
             cost_micros = (SELECT COALESCE(SUM(cost_micros),0) FROM ai_invocation WHERE context_type = 'research_run' AND context_id = ?),
             input_tokens = (SELECT COALESCE(SUM(input_tokens),0) FROM ai_invocation WHERE context_type = 'research_run' AND context_id = ?),
             output_tokens = (SELECT COALESCE(SUM(output_tokens),0) FROM ai_invocation WHERE context_type = 'research_run' AND context_id = ?),
             retries = (SELECT COALESCE(SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END),0) FROM ai_invocation WHERE context_type = 'research_run' AND context_id = ?)
           WHERE id = ?`,
        )
        .run(ctx.run.id, ctx.run.id, ctx.run.id, ctx.run.id, ctx.run.id),
    );
    if (!result.ok) return { proposed: 0, failed: true };
    const parsed = AccountHypothesisProposalsSchema.parse(result.data);
    const prompt = PROMPTS.find((p) => p.name === "hypothesis-propose")!;
    const promptRow = this.db.raw
      .prepare("SELECT id FROM prompt_version WHERE name = ? AND version = ?")
      .get(prompt.name, prompt.version) as { id: string };
    const model = this.gateway.modelName("synthesis");
    let proposed = 0;
    let dropped = 0;
    this.db.transaction((tx) => {
      for (const p of parsed.proposals) {
        const statement = p.statement.trim();
        const supporting = [
          ...new Set(
            p.supportingFindingKeys.map((k) => keyOf.get(k)).filter((x): x is string => Boolean(x)),
          ),
        ];
        const contradictory = [
          ...new Set(
            p.contradictoryFindingKeys
              .map((k) => keyOf.get(k))
              .filter((x): x is string => Boolean(x)),
          ),
        ].filter((s) => !supporting.includes(s));
        const category = tx
          .prepare("SELECT 1 FROM hypothesis_category WHERE key = ? AND active = 1")
          .get(p.category);
        const guard = guardValue({
          statement,
          explanation: p.confidence.explanation,
          assumptions: p.assumptions,
        });
        if (
          supporting.length === 0 ||
          !checkStatement(statement).ok ||
          !category ||
          guard.decision !== "allow"
        ) {
          dropped += 1;
          continue;
        }
        const id = uuidv7();
        const at = this.now().toISOString();
        tx.prepare(
          `INSERT INTO account_hypothesis (id, account_id, origin, acceptance, statement, proposed_statement, category, status,
             not_for_prioritisation, confidence_band, confidence_explanation, proposed_by_run_id, ai_model, ai_prompt_version_id, created_at, updated_at)
           VALUES (?,?,'ai','proposed',?,?,?,NULL,?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          ctx.accountId,
          statement,
          statement,
          p.category,
          ctx.excluded ? 1 : 0,
          p.confidence.band,
          p.confidence.explanation.trim(),
          ctx.run.id,
          model,
          promptRow.id,
          at,
          at,
        );
        const link = tx.prepare(
          "INSERT INTO hypothesis_evidence (id, hypothesis_id, signal_id, role, linked_by_type, linked_at) VALUES (?,?,?,?,'ai',?)",
        );
        for (const s of supporting) link.run(uuidv7(), id, s, "supporting", at);
        for (const s of contradictory) link.run(uuidv7(), id, s, "contradictory", at);
        const tag = tx.prepare(
          "INSERT OR IGNORE INTO hypothesis_tag (hypothesis_id, dimension, value) VALUES (?,?,?)",
        );
        for (const v of p.relevance.icp) tag.run(id, "icp", v);
        for (const v of p.relevance.capability)
          if (tx.prepare("SELECT 1 FROM service_capability_provisional WHERE key = ?").get(v))
            tag.run(id, "capability", v);
        for (const v of p.relevance.offer) if (/^[a-z0-9_]{1,60}$/.test(v)) tag.run(id, "offer", v);
        const ass = tx.prepare(
          "INSERT INTO hypothesis_assumption (id, hypothesis_id, text, source, added_by, added_at) VALUES (?,?,?,'ai','ai',?)",
        );
        for (const a of p.assumptions) ass.run(uuidv7(), id, a.trim(), at);
        proposed += 1;
      }
      recordAudit(
        tx,
        {
          actorId: null,
          actorType: "ai",
          action: "hypothesis.propose",
          entityType: "research_run",
          entityId: ctx.run.id,
          outcome: "success",
          after: { proposed, dropped },
          correlationId: ctx.run.correlation_id,
        },
        this.now,
      );
    });
    return { proposed };
  }
}
