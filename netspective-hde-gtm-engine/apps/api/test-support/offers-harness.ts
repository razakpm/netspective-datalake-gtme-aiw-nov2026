import { FakeFileStorage, FakeLLM, type FakeRule } from "@gtm/providers";
import { v7 as uuidv7 } from "uuid";
import { HypothesisService } from "../src/modules/hypotheses/index.js";
import { IcpService } from "../src/modules/icp/index.js";
import { ContactsService, SuppressionService } from "../src/modules/contacts/index.js";
import {
  FakeConsentReader,
  FakePriorInteractions,
  RecommendationService,
  RoutingContextBuilder,
  RuleSetService,
} from "../src/modules/offers/index.js";
import { LlmGateway } from "../src/modules/providers/llm-gateway.js";
import { buildCatalogueHarness, type CatalogueHarnessOptions } from "./catalogue-harness.js";

// An offers and routing stack on an in-memory database with all migrations and seeds, a fake clock, fake
// providers and actors for each role (feature 006 tests, task T026). It builds on the feature 005
// harness, which already holds the offers, capacity and booking services.

export const HASH_KEY = "h".repeat(32);
export const SIGNING_KEY = "s".repeat(32);

/** Synthetic organisations (see tests/fixtures/synthetic-orgs). */
export const ORGS = {
  northvale: {
    id: "acc-northvale",
    name: "Northvale HIE",
    type: "health_information_exchange",
    domain: "northvale-hie.example",
  },
  riverbend: {
    id: "acc-riverbend",
    name: "Riverbend Health",
    type: "health_system",
    domain: "riverbend-health.example",
  },
  summitcare: {
    id: "acc-summitcare",
    name: "SummitCare Health",
    type: "health_system",
    domain: "summitcare-health.example",
  },
  helixbio: { id: "acc-helixbio", name: "Helixbio", type: "biotech", domain: "helixbio.example" },
  lakeshore: {
    id: "acc-lakeshore",
    name: "Lakeshore HIE",
    type: "health_information_exchange",
    domain: "lakeshore-hie.example",
  },
} as const;
export type OrgKey = keyof typeof ORGS;

export interface OffersHarnessOptions extends CatalogueHarnessOptions {
  recommendationAi?: boolean;
  llmRules?: FakeRule[];
  supportedMinBand?: "low" | "medium" | "high";
}

export function buildOffersHarness(options: OffersHarnessOptions = {}) {
  const base = buildCatalogueHarness(options);
  const { db, now } = base;
  const contacts = new ContactsService(db, { hashKey: HASH_KEY });
  const suppression = new SuppressionService(db);
  const icp = new IcpService(db);
  const hypotheses = new HypothesisService(db, 90, now);
  const consent = new FakeConsentReader();
  const prior = new FakePriorInteractions();
  const llm = new FakeLLM(options.llmRules ?? []);
  const gateway = new LlmGateway({
    db,
    provider: llm,
    models: { extraction: "m-small", synthesis: "m-large" },
    rates: {
      extraction: { inMicrosPer1k: 1000, outMicrosPer1k: 5000 },
      synthesis: { inMicrosPer1k: 1000, outMicrosPer1k: 5000 },
    },
    maxRetries: 1,
    now,
    boundary: () => "bnd-test",
  });
  const rules = new RuleSetService(db);
  const builder = new RoutingContextBuilder({
    db,
    hypotheses,
    icp,
    capacity: base.capacity,
    prior,
    consent,
  });
  const recommendations = new RecommendationService(db, rules, builder, gateway, {
    recommendationAi: options.recommendationAi ?? false,
    supportedMinBand: options.supportedMinBand ?? "medium",
    aiCapMicros: 200_000,
  });
  const files = new FakeFileStorage(SIGNING_KEY);

  const writeCtx = {
    actorId: "system",
    actorType: "system" as const,
    correlationId: "corr-test",
    now,
  };

  /** An account with its type, domain and evidence, assessed for ICP fit. */
  const org = (
    key: OrgKey,
    evidence: [topic: string, status: string][] = [],
    beds: number | null = null,
  ) => {
    const o = ORGS[key];
    const at = now().toISOString();
    db.raw
      .prepare(
        "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES (?,?,?,?,?)",
      )
      .run(o.id, o.name, o.name.toLowerCase(), at, at);
    db.raw
      .prepare(
        "INSERT INTO account_classification (id, account_id, org_type, staffed_bed_count, recorded_at) VALUES (?,?,?,?,?)",
      )
      .run(`cl-${o.id}`, o.id, o.type, beds, at);
    db.raw
      .prepare("INSERT INTO account_domain (id, account_id, domain, created_at) VALUES (?,?,?,?)")
      .run(`dom-${o.id}`, o.id, o.domain, at);
    for (const [topic, status] of evidence) {
      db.raw
        .prepare(
          "INSERT INTO evidence_reference (id, account_id, topic, what, where_ref, observed_at, recorded_at, status) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(uuidv7(), o.id, topic, "synthetic", "ref", at, at, status);
    }
    db.transaction((tx) => icp.assess(tx, o.id, writeCtx));
    return o;
  };

  /** A business contact at an account, with a permitted-use basis and (optionally) a consent state. */
  const contact = (
    accountId: string,
    email: string,
    over: {
      role?: string;
      basis?: string;
      consent?: "given" | "not_given" | "none";
      buyerRole?: string;
    } = {},
  ) => {
    const r = db.transaction((tx) =>
      contacts.findOrCreateByBusinessEmail(
        tx,
        {
          email,
          role: over.role ?? "Integration Lead",
          accountId,
          source: "first_party_form",
          basis: over.basis ?? "b2b_legitimate_interest",
          documentedOrigin: "synthetic",
        },
        writeCtx,
      ),
    );
    if (!r.ok) throw new Error(`contact refused: ${r.code}`);
    if (over.consent) consent.set(r.contactId, over.consent);
    if (over.buyerRole) {
      db.raw
        .prepare("UPDATE account_contact_relationship SET role_inferred = ? WHERE contact_id = ?")
        .run(over.buyerRole, r.contactId);
    }
    return { id: r.contactId, emailHash: r.emailHash };
  };

  /** An accepted analyst hypothesis. `signals` approved current supporting signals are attached when asked. */
  const hypothesis = (
    accountId: string,
    category: string,
    over: {
      status?: string;
      band?: "low" | "medium" | "high";
      capabilities?: string[];
      id?: string;
    } = {},
  ) => {
    const id = over.id ?? uuidv7();
    const at = now().toISOString();
    db.raw
      .prepare(
        `INSERT INTO account_hypothesis (id, account_id, origin, acceptance, statement, category, status, confidence_band,
         confidence_explanation, created_by, created_at, updated_at, accepted_by, accepted_at)
       VALUES (?,?,'analyst','accepted','A testable statement about this account.',?,?,?,'synthetic',?,?,?,?,?)`,
      )
      .run(
        id,
        accountId,
        category,
        over.status ?? "strengthening",
        over.band ?? "medium",
        "analyst-1",
        at,
        at,
        "analyst-1",
        at,
      );
    for (const c of over.capabilities ?? []) {
      db.raw
        .prepare(
          "INSERT INTO hypothesis_tag (hypothesis_id, dimension, value) VALUES (?, 'capability', ?)",
        )
        .run(id, c);
    }
    return id;
  };
  const setHypothesisStatus = (id: string, status: string) =>
    db.raw.prepare("UPDATE account_hypothesis SET status = ? WHERE id = ?").run(status, id);

  /** Fill an offer's capacity for the current month by recording bookings. */
  const fillCapacity = (offerId: string, sessions: number) => {
    const lead = base.actor("lead");
    for (let i = 0; i < sessions; i++) {
      base.bookings.record(lead, offerId, {
        sessionDate: now().toISOString().slice(0, 10),
        externalRef: `fill-${offerId}-${i}`,
      });
    }
  };

  /** One approved notice version (the form is unavailable until one exists). */
  const approveNotice = () => {
    const at = now().toISOString();
    const id = `notice-${uuidv7()}`;
    const version = (
      db.raw.prepare("SELECT COALESCE(MAX(version),0)+1 v FROM notice_version").get() as {
        v: number;
      }
    ).v;
    db.raw
      .prepare(
        "INSERT INTO notice_version (id, version, notice_text, consent_text, created_by, created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        version,
        "Synthetic privacy notice.",
        "I agree to be contacted about this topic.",
        "author-1",
        at,
      );
    db.raw
      .prepare("UPDATE notice_version SET approved_by = 'approver-1', approved_at = ? WHERE id = ?")
      .run(at, id);
    return id;
  };

  const offerId = (n: 1 | 5 | 6) => `offer-${n}`;
  return {
    ...base,
    contacts,
    suppression,
    icp,
    hypotheses,
    consent,
    prior,
    llm,
    gateway,
    rules,
    builder,
    recommendations,
    files,
    writeCtx,
    org,
    contact,
    hypothesis,
    setHypothesisStatus,
    fillCapacity,
    approveNotice,
    offerId,
    ORGS,
  };
}

export type OffersHarness = ReturnType<typeof buildOffersHarness>;
