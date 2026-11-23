import { createHash } from "node:crypto";
import type { SqliteDatabase } from "@gtm/db";
import type { OfferFact, RoutingContext, RuleSet, Trigger } from "@gtm/domain";
import { HttpError } from "../../http/errors.js";
import { getAccount } from "../accounts/index.js";
import { buyerRoleOf, checkSuppression, contactById, latestBasis } from "../contacts/index.js";
import type { HypothesisService } from "../hypotheses/index.js";
import type { IcpService } from "../icp/index.js";
import type { CapacityService } from "./capacity.js";
import type { ConsentReader, PriorInteractions } from "./ports.js";
import { getVersionRow, getHead } from "./repository.js";
import { parseSnapshot } from "./queries.js";

// Builds the routing context from the other modules' public views (feature 006, research R-04, R-14). It
// only reads. Call it outside a transaction: the capacity answer opens its own.

export interface ContextDeps {
  db: SqliteDatabase;
  hypotheses: Pick<HypothesisService, "routingFacts">;
  icp: Pick<IcpService, "currentFit">;
  capacity: Pick<CapacityService, "statusIn">;
  prior: PriorInteractions;
  consent: ConsentReader;
}

const IN_FORCE = new Set(["approved", "available"]);

/** The offer keys a rule set names, so a draft offer a rule points at is shown as unavailable. */
export function ruleOfferKeys(rules: RuleSet): Set<string> {
  const keys = new Set<string>();
  for (const r of rules.rules) {
    const t = r.then;
    if ("offerKey" in t) keys.add(t.offerKey);
    else if ("offerByIcp" in t) {
      keys.add(t.offerByIcp.icp1);
      keys.add(t.offerByIcp.icp2);
    }
  }
  return keys;
}

export class RoutingContextBuilder {
  constructor(private readonly d: ContextDeps) {}

  build(input: {
    accountId: string;
    contactId: string | null;
    trigger: Trigger;
    rules: RuleSet;
    now: Date;
  }): { context: RoutingContext; inputsHash: string } {
    const tx = this.d.db.raw;
    const account = getAccount(tx, input.accountId);
    if (!account) throw new HttpError(404, "Account not found");
    const fit = this.d.icp.currentFit(account.id);

    let contact: RoutingContext["contact"] = null;
    if (input.contactId) {
      const row = contactById(tx, input.contactId);
      if (!row) throw new HttpError(404, "Contact not found");
      contact = {
        id: row.id,
        suppressed: checkSuppression(tx, {
          contactId: row.id,
          emailHash: row.emailHash,
        }).suppressed,
        consent: this.d.consent.latest({ contactId: row.id, emailHash: row.emailHash }),
        permittedBasis: row.erasedAt === null && latestBasis(tx, row.id) !== null,
        buyerRole: buyerRoleOf(tx, account.id, row.id),
      };
    }
    const accountSuppressed = checkSuppression(tx, { accountId: account.id }).suppressed;

    const named = ruleOfferKeys(input.rules);
    const offers: OfferFact[] = [];
    const heads = tx.prepare("SELECT id FROM engagement_offer ORDER BY number").all() as {
      id: string;
    }[];
    for (const h of heads) {
      const status = this.d.capacity.statusIn(tx, h.id, input.now);
      const head = getHead(tx, h.id)!;
      const available = IN_FORCE.has(status.offerStatus);
      if (!available && !named.has(head.key)) continue;
      const versionNo = head.inForceVersionNo ?? head.latestVersionNo;
      const version = getVersionRow(tx, h.id, versionNo);
      offers.push({
        id: head.id,
        key: head.key,
        number: head.number,
        available,
        capacity: status.state,
        effort: version ? (parseSnapshot(version).buyerEffort ?? null) : null,
      });
    }

    const prior = this.d.prior.forAccount(account.id, input.contactId);
    const acceptedOffers = (
      tx
        .prepare(
          "SELECT count(*) c FROM offer_recommendation WHERE account_id = ? AND review_state = 'accepted'",
        )
        .get(account.id) as { c: number }
    ).c;

    const context: RoutingContext = {
      trigger: input.trigger,
      account: {
        id: account.id,
        icp: fit.icp,
        fit: fit.fit,
        suppressed: accountSuppressed,
      },
      contact,
      hypotheses: this.d.hypotheses.routingFacts(account.id, input.now),
      offers,
      prior: { ...prior, acceptedOffers },
    };
    return { context, inputsHash: hashContext(context) };
  }
}

/** A stable hash of the facts a recommendation used; a change in any of them makes it out of date. */
export function hashContext(context: RoutingContext): string {
  // Prior interactions are shown in an explanation but no rule reads them, so a repeat download does not
  // make a pending recommendation out of date or create a second one (spec FR-022).
  const { prior: _prior, ...facts } = context;
  void _prior;
  return createHash("sha256").update(canonical(facts)).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
