import { PROMPTS } from "@gtm/ai-contracts";
import type { SqliteDatabase } from "@gtm/db";
import { createHash } from "node:crypto";
import { checkAssessment, formatMicros, guardValue, sanitizeInterpretation } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { HttpError } from "../../http/errors.js";
import { recordAudit } from "../audit/index.js";
import { LlmGateway, buildModelInput } from "../providers/index.js";
import { resolveAccountScope } from "../signals/index.js";
import { accountFacts, accountSpendMicros } from "./repository.js";
import { monthStart, type ResearchActor, type ResearchSettings } from "./settings.js";

// The Healthcare Data Problem Agent (task T051; spec FR-032 to FR-034). A buyer-supplied non-PHI statement
// becomes advisory capability matches and suggested discovery questions. The statement is guarded before any
// model sees it and only its hash is kept. The result never creates a buyer-confirmed fact, a qualification
// fact or a status change; an analyst may attach it to a hypothesis only as an assumption.

export interface InterpretationView {
  id: string;
  accountId: string;
  label: "AI-generated, advisory";
  matches: { capabilityKey: string; band: "low" | "medium" | "high"; reason: string }[];
  discoveryQuestions: string[];
  unknowns: string[];
  modelAndPrompt: { model: string; promptVersion: string };
  cost: string;
  createdAt: string;
}

export class ProblemInterpreter {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly gateway: LlmGateway,
    private readonly settings: ResearchSettings,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private refuse(
    actor: ResearchActor,
    status: number,
    title: string,
    codes: string[],
    ruleIds: string[] = [],
  ): never {
    this.db.transaction((tx) =>
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "interpretation.refused",
          entityType: "problem_interpretation",
          outcome: "denied",
          after: { codes, rule_ids: ruleIds },
          correlationId: actor.correlationId,
        },
        this.now,
      ),
    );
    throw new HttpError(
      status,
      title,
      ruleIds.length
        ? `Rejected by the PHI boundary guard (${ruleIds.join(", ")})`
        : `Refused: ${codes.join(", ")}`,
      ruleIds.length ? { ruleIds } : {},
    );
  }

  async interpret(
    actor: ResearchActor,
    accountId: string,
    input: { statement: string; sourceSignalId?: string | undefined },
  ): Promise<InterpretationView> {
    if (actor.actorType !== "human" || !actor.userId)
      throw new HttpError(403, "Forbidden", "Only a person can request an interpretation");
    const statement = input.statement.trim();
    if (statement.length < 10 || statement.length > 2000)
      this.refuse(actor, 400, "Invalid statement", ["statement_length"]);
    const guard = guardValue({ statement });
    if (guard.decision !== "allow")
      this.refuse(actor, 422, "Statement refused", ["phi_guard"], guard.rule_ids);

    const setup = this.db.transaction((tx) => {
      const scope = resolveAccountScope(tx, accountId);
      if (!scope) return null;
      const facts = accountFacts(tx, scope.survivor);
      if (input.sourceSignalId) {
        const s = tx
          .prepare("SELECT account_id FROM signal WHERE id = ?")
          .get(input.sourceSignalId) as { account_id: string } | undefined;
        if (!s || !scope.ids.includes(s.account_id)) return "bad_signal" as const;
      }
      const keys = (
        tx
          .prepare("SELECT key FROM service_capability_provisional WHERE active = 1 ORDER BY key")
          .all() as { key: string }[]
      ).map((r) => r.key);
      return { scope, facts: facts!, keys };
    });
    if (setup === null) this.refuse(actor, 404, "Not found", ["unknown_account"]);
    if (setup === "bad_signal")
      this.refuse(actor, 422, "Statement refused", ["unknown_source_signal"]);

    const id = uuidv7();
    const prompt = PROMPTS.find((p) => p.name === "problem-interpret")!;
    const result = await this.gateway.call({
      task: "interpretation",
      promptName: "problem-interpret",
      modelInput: buildModelInput({
        account: {
          name: setup.facts.name,
          type: setup.facts.orgType,
          domain: setup.facts.domains[0],
        },
        sources: [],
        signalObservations: [],
        statement,
        reference: { signalTypeKeys: [], categoryKeys: [], capabilityKeys: setup.keys },
      }),
      contextType: "problem_interpretation",
      contextId: id,
      accountId: setup.scope.survivor,
      runCapMicros: this.settings.interpretationCapMicros,
      accountRemaining: () =>
        Math.max(
          0,
          this.settings.accountMonthlyCapMicros -
            this.db.transaction((tx) =>
              accountSpendMicros(tx, setup.scope.survivor, monthStart(this.now())),
            ),
        ),
      actor: { id: actor.userId, type: "human" },
      correlationId: actor.correlationId,
    });
    if (!result.ok) {
      const code = result.code === "provider_error" ? "provider_error" : result.code;
      this.refuse(actor, 422, "Interpretation refused", [code], result.ruleIds ?? []);
    }
    const data = result.data as {
      matches: { capabilityKey: string; band: "low" | "medium" | "high"; reason: string }[];
      discoveryQuestions: string[];
      unknowns: string[];
    };
    const clean = sanitizeInterpretation({
      matches: data.matches,
      discoveryQuestions: data.discoveryQuestions,
      allowedCapabilityKeys: new Set(setup.keys),
    });
    const textCheck = guardValue({
      r: clean.matches.map((m) => m.reason),
      q: clean.discoveryQuestions,
      u: data.unknowns,
    });
    if (textCheck.decision !== "allow")
      this.refuse(actor, 422, "Interpretation refused", ["phi_guard_output"], textCheck.rule_ids);

    const row = this.db.raw
      .prepare("SELECT id FROM prompt_version WHERE name = ? AND version = ?")
      .get(prompt.name, prompt.version) as { id: string };
    const model = this.gateway.modelName("interpretation");
    const at = this.now().toISOString();
    this.db.transaction((tx) => {
      tx.prepare(
        `INSERT INTO problem_interpretation (id, account_id, source_signal_id, statement_sha256, matches_json, questions_json, unknowns_json,
           ai_model, ai_prompt_version_id, requested_by, cost_micros, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        setup.scope.survivor,
        input.sourceSignalId ?? null,
        createHash("sha256").update(statement).digest("hex"),
        JSON.stringify(clean.matches),
        JSON.stringify(clean.discoveryQuestions),
        JSON.stringify(data.unknowns),
        model,
        row.id,
        actor.userId,
        result.costMicros,
        at,
      );
      for (const m of clean.matches) {
        if (
          !checkAssessment({ dimension: "capability_match", band: m.band, explanation: m.reason })
            .ok
        )
          continue;
        tx.prepare(
          `INSERT INTO confidence_assessment (id, subject_type, subject_id, dimension, band, explanation, assessed_by_type, assessed_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        ).run(
          uuidv7(),
          "interpretation",
          `${id}:${m.capabilityKey}`,
          "capability_match",
          m.band,
          m.reason,
          "ai",
          at,
        );
      }
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: "human",
          action: "interpretation.create",
          entityType: "problem_interpretation",
          entityId: id,
          outcome: "success",
          after: {
            matches: clean.matches.length,
            questions: clean.discoveryQuestions.length,
            dropped_matches: clean.dropped.matches,
            dropped_questions: clean.dropped.questions,
          },
          correlationId: actor.correlationId,
        },
        this.now,
      );
    });
    return {
      id,
      accountId: setup.scope.survivor,
      label: "AI-generated, advisory",
      matches: clean.matches,
      discoveryQuestions: clean.discoveryQuestions,
      unknowns: data.unknowns,
      modelAndPrompt: { model, promptVersion: `${prompt.name}@${prompt.version}` },
      cost: formatMicros(result.costMicros),
      createdAt: at,
    };
  }
}
