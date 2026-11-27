import type { SqliteDatabase } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";
import type { CatalogueActor } from "../../platform/catalogue.js";
import { currentClassification, getAccount } from "../accounts/index.js";
import { offerFacts } from "../offers/index.js";
import type { LlmGateway, ModelInput } from "../providers/index.js";
import type { WorkshopRow } from "./repository.js";

// One bounded model call for a workshop (feature 007, research R-09; constitution X, XI, XIII): off unless
// configured, checked against the per-call cap and the account's monthly allowance, validated against its
// schema by the gateway and recorded in `ai_invocation` with no text. A failure is a plain notice.

export interface ModelDeps {
  gateway: LlmGateway;
  /** Off by default. */
  enabled: boolean;
  capMicros: number;
  /** What is left of the account's monthly allowance. */
  accountRemaining: (accountId: string) => number;
}

export interface Invocation {
  id: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
}

export type ModelCall<T> =
  { ok: true; data: T; invocation: Invocation } | { ok: false; notice: string };

const NOTICES = {
  off: "The model is switched off.",
  budget_refused: "The model was not called: the cost cap would be exceeded.",
  invalid_output: "The model's answer did not fit the expected shape.",
  provider_error: "The model is not available.",
  prompt_retired: "The model prompt is not approved.",
  phi_blocked: "The model was not called: the text did not pass the data check.",
} as const;

export async function callModel<T>(
  db: SqliteDatabase,
  d: ModelDeps,
  actor: CatalogueActor,
  call: {
    promptName: "workshop-brief" | "workshop-findings";
    workshop: WorkshopRow;
    input: (account: ModelInput["account"], offerKey: string) => ModelInput;
  },
): Promise<ModelCall<T>> {
  if (!d.enabled) return { ok: false, notice: NOTICES.off };
  const { workshop } = call;
  const account = {
    name: getAccount(db.raw, workshop.accountId)?.name ?? "the account",
    type: currentClassification(db.raw, workshop.accountId).orgType,
  };
  // One context per call, so the cap is a cap on this call.
  const contextId = `${workshop.id}:${uuidv7()}`;
  const result = await d.gateway.call({
    task: "synthesis",
    promptName: call.promptName,
    modelInput: call.input(account, offerFacts(db.raw, workshop.offerId)?.key ?? workshop.offerId),
    contextType: "other",
    contextId,
    accountId: workshop.accountId,
    runCapMicros: d.capMicros,
    accountRemaining: () => d.accountRemaining(workshop.accountId),
    actor: { id: actor.userId, type: actor.actorType },
    correlationId: actor.correlationId,
  });
  if (!result.ok) return { ok: false, notice: NOTICES[result.code] };
  const row = db.raw
    .prepare(
      `SELECT i.id, i.model, i.schema_version, p.version AS prompt_version
       FROM ai_invocation i JOIN prompt_version p ON p.id = i.prompt_version_id
       WHERE i.context_id = ? ORDER BY i.rowid DESC LIMIT 1`,
    )
    .get(contextId) as {
    id: string;
    model: string;
    schema_version: string;
    prompt_version: string;
  };
  return {
    ok: true,
    data: result.data as T,
    invocation: {
      id: row.id,
      model: row.model,
      promptVersion: row.prompt_version,
      schemaVersion: row.schema_version,
    },
  };
}
