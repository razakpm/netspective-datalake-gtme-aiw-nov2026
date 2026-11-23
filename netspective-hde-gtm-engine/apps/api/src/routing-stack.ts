import type { SqliteDatabase } from "@gtm/db";
import type { ConsentState } from "@gtm/domain";
import type { AppConfig } from "./config/index.js";
import type { CatalogueStack } from "./catalogue-stack.js";
import { ContactsService, SuppressionService } from "./modules/contacts/index.js";
import type { HypothesisService } from "./modules/hypotheses/index.js";
import { IcpService } from "./modules/icp/index.js";
import {
  NO_CONSENT_RECORDS,
  NO_PRIOR_INTERACTIONS,
  RecommendationService,
  RoutingContextBuilder,
  RuleSetService,
  type ConsentReader,
  type PriorInteractions,
} from "./modules/offers/index.js";
import type { LlmGateway } from "./modules/providers/llm-gateway.js";

// Composition of the contacts, ICP and routing services (feature 006, task T037). The routing context reads
// prior interactions and consent through two ports that `engagement` fills in when it is built, so `offers`
// never imports `engagement` (research R-01).

/** Delegates to whatever `engagement` wires in; harmless defaults until then. */
class LatePorts implements PriorInteractions, ConsentReader {
  private prior: PriorInteractions = NO_PRIOR_INTERACTIONS;
  private consent: ConsentReader = NO_CONSENT_RECORDS;
  wire(ports: { prior?: PriorInteractions; consent?: ConsentReader }): void {
    if (ports.prior) this.prior = ports.prior;
    if (ports.consent) this.consent = ports.consent;
  }
  forAccount(accountId: string, contactId: string | null) {
    return this.prior.forAccount(accountId, contactId);
  }
  latest(who: { contactId: string | null; emailHash: string | null }): ConsentState {
    return this.consent.latest(who);
  }
}

export interface RoutingStackOptions {
  db: SqliteDatabase;
  config: AppConfig;
  catalogue: CatalogueStack;
  hypotheses: HypothesisService;
  gateway: LlmGateway;
}

export function buildRoutingStack(o: RoutingStackOptions) {
  const ports = new LatePorts();
  const contacts = new ContactsService(o.db, { hashKey: o.config.suppressionHashKey });
  const suppression = new SuppressionService(o.db);
  const icp = new IcpService(o.db);
  const ruleSets = new RuleSetService(o.db);
  const builder = new RoutingContextBuilder({
    db: o.db,
    hypotheses: o.hypotheses,
    icp,
    capacity: o.catalogue.capacity,
    prior: ports,
    consent: ports,
  });
  const recommendations = new RecommendationService(o.db, ruleSets, builder, o.gateway, {
    recommendationAi: o.config.routing.recommendationAi,
    supportedMinBand: o.config.routing.supportedMinBand,
    aiCapMicros: o.config.research.interpretationCapMicros,
  });
  return { contacts, suppression, icp, ruleSets, builder, recommendations, ports };
}

export type RoutingStack = ReturnType<typeof buildRoutingStack>;
