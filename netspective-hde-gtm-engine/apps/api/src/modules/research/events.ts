import type { Tx } from "@gtm/db";
import { toAccountResearchedPayload, type ActorType } from "@gtm/domain";
import { writeOutbox } from "../../platform/events/outbox.js";

// Outbox events of the research module (task T035). Identifiers and counts only.
export function emitResearched(
  tx: Tx,
  c: {
    actorId: string | null;
    actorType: ActorType;
    correlationId: string | null;
    now?: (() => Date) | undefined;
  },
  p: {
    runId: string;
    accountId: string;
    state: "completed" | "budget_reached";
    signalsCreated: number;
    injectionFlags: number;
    costMicros: number;
  },
): void {
  writeOutbox(
    tx,
    {
      type: "account.researched",
      actor: { id: c.actorId, type: c.actorType },
      correlation_id: c.correlationId,
      causation_id: null,
      idempotency_key: null,
      payload: toAccountResearchedPayload({
        run_id: p.runId,
        account_id: p.accountId,
        state: p.state,
        signals_created: p.signalsCreated,
        injection_flags: p.injectionFlags,
        cost_micros: p.costMicros,
      }),
      provenance: { source: "research" },
    },
    c.now,
  );
}
