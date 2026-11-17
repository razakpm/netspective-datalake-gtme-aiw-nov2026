import type { Tx } from "@gtm/db";
import { writeOutbox } from "./outbox.js";

// Operator notification for PHI blocks and quarantines (task T069, spec FR-019). An alert is an outbox
// event `operator.alert.phi`; recipients are users holding `quarantine.review`, resolved when the alert
// is read or delivered. The payload carries entry point, rule IDs, time and correlation ID only, and is
// rate limited per entry point so an attacker cannot turn the alert channel into a flood.

export interface PhiAlertInput {
  entryPoint: string;
  action: "reject" | "quarantine";
  ruleIds: string[];
  correlationId: string | null;
}

export class PhiNotifier {
  private readonly lastSent = new Map<string, number>();
  suppressed = 0;

  constructor(
    private readonly minIntervalMs = 60_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Returns true when an alert was raised, false when it was suppressed by the rate limit. */
  notify(tx: Tx, alert: PhiAlertInput): boolean {
    const nowMs = this.now().getTime();
    const last = this.lastSent.get(alert.entryPoint);
    if (last !== undefined && nowMs - last < this.minIntervalMs) {
      this.suppressed += 1;
      return false;
    }
    writeOutbox(
      tx,
      {
        type: "operator.alert.phi",
        actor: { id: null, type: "system" },
        correlation_id: alert.correlationId,
        causation_id: null,
        idempotency_key: null,
        payload: {
          entryPoint: alert.entryPoint,
          action: alert.action,
          ruleIds: alert.ruleIds,
          occurredAt: this.now().toISOString(),
          correlationId: alert.correlationId,
          recipients: "quarantine.review",
        },
        provenance: { source: "phi-guard" },
      },
      this.now,
    );
    this.lastSent.set(alert.entryPoint, nowMs);
    return true;
  }
}
