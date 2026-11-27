import { createHash } from "node:crypto";
import type { SqliteDatabase, Tx } from "@gtm/db";
import { bestFit, evaluateFit, parseIcpDefinition, type FitStatus, type IcpKey } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { currentClassification } from "../accounts/index.js";
import { recordAudit } from "../audit/index.js";
import type { WriteContext } from "../contacts/index.js";
import {
  activeDefinitions,
  fitEvidenceFor,
  insertAssessment,
  latestAssessments,
} from "./repository.js";

// ICP fit assessment service (feature 002 US3 slice, built in feature 006). Assesses an account against
// the active definition of each ICP by fixed rules and stores one append-only assessment per ICP. A new
// assessment never changes an earlier one. No model is involved.

export interface FitSummary {
  icp: IcpKey | null;
  fit: FitStatus;
  byIcp: Partial<Record<IcpKey, FitStatus>>;
}

export class IcpService {
  constructor(private readonly db: SqliteDatabase) {}

  /** Assess inside the caller's transaction. */
  assess(tx: Tx, accountId: string, ctx: WriteContext): FitSummary {
    const { orgType, staffedBedCount } = currentClassification(tx, accountId);
    const evidence = fitEvidenceFor(tx, accountId);
    const at = (ctx.now ?? (() => new Date()))().toISOString();
    const byIcp: Partial<Record<IcpKey, FitStatus>> = {};
    for (const row of activeDefinitions(tx)) {
      const parsed = parseIcpDefinition(JSON.parse(row.rules));
      if (!parsed.ok) continue;
      const result = evaluateFit(parsed.definition, { orgType, staffedBedCount, evidence });
      const inputsHash = createHash("sha256")
        .update(
          JSON.stringify({
            v: row.version,
            orgType,
            staffedBedCount,
            evidence: evidence.map((e) => `${e.topic}:${e.status}`).sort(),
          }),
        )
        .digest("hex");
      const id = uuidv7();
      insertAssessment(tx, {
        id,
        accountId,
        icp: row.icp,
        definitionId: row.id,
        definitionVersion: row.version,
        status: result.status,
        confidence: result.confidence,
        basis: result.basis,
        met: result.met,
        unmet: result.unmet,
        missing: result.missing,
        contradictory: result.contradictory,
        inputsHash,
        assessedBy: ctx.actorId,
        assessedAt: at,
      });
      byIcp[row.icp] = result.status;
      recordAudit(
        tx,
        {
          actorId: ctx.actorId,
          actorType: ctx.actorType,
          action: "icp.assess",
          entityType: "icp_fit_assessment",
          entityId: id,
          outcome: "success",
          after: { icp: row.icp, status: result.status, definition_version: row.version },
          correlationId: ctx.correlationId,
        },
        ctx.now,
      );
    }
    return { ...bestFit(byIcp), byIcp };
  }

  /** The latest stored assessment of each ICP, reduced to the account's best fit. */
  currentFit(accountId: string, tx: Tx = this.db.raw): FitSummary {
    const byIcp: Partial<Record<IcpKey, FitStatus>> = {};
    for (const a of latestAssessments(tx, accountId)) byIcp[a.icp] = a.status as FitStatus;
    return { ...bestFit(byIcp), byIcp };
  }
}
