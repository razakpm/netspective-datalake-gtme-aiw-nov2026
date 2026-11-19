import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { FakeLLM, FakeResearchSource, type FakePage, type FakeRule } from "@gtm/providers";
import { JobService } from "../src/modules/jobs/index.js";
import { LlmGateway } from "../src/modules/providers/index.js";
import {
  ProblemInterpreter,
  DEFAULT_RESEARCH_SETTINGS,
  ResearchRunner,
  ResearchService,
  type HypothesisProposer,
  type ResearchActor,
  type ResearchSettings,
} from "../src/modules/research/index.js";
import { SignalService, ReviewService as SignalReview } from "../src/modules/signals/index.js";
import {
  HypothesisProposals,
  HypothesisReview,
  HypothesisService,
  HypothesisStaleness,
} from "../src/modules/hypotheses/index.js";
import { accountSpendMicros } from "../src/modules/research/repository.js";
import { monthStart } from "../src/modules/research/settings.js";

// A research stack on an in-memory database with the fake model and fake pages (feature 004 tests).
const FIXTURES = join(import.meta.dirname, "../../../tests/fixtures/research");

export const loadPages = (): FakePage[] =>
  readdirSync(join(FIXTURES, "pages"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES, "pages", f), "utf8")) as FakePage);

export function loadScenario(name: string): { rules: FakeRule[]; obeyInjection: boolean } {
  const json = JSON.parse(readFileSync(join(FIXTURES, "llm", `${name}.json`), "utf8")) as {
    rules: FakeRule[];
    obeyInjection?: boolean;
  };
  return { rules: json.rules, obeyInjection: json.obeyInjection === true };
}

export const ACCOUNTS = {
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
  lakeshore: {
    id: "acc-lakeshore",
    name: "Lakeshore HIE",
    type: "health_information_exchange",
    domain: "lakeshore-hie.example",
  },
  summitcare: {
    id: "acc-summitcare",
    name: "Summitcare Health",
    type: "health_system",
    domain: "summitcare-health.example",
  },
  helixbio: { id: "acc-helixbio", name: "Helixbio", type: "biotech", domain: "helixbio.example" },
  granite: {
    id: "acc-granite",
    name: "Granite Health",
    type: "health_system",
    domain: "granite-health.example",
  },
} as const;

export interface HarnessOptions {
  scenario?: string;
  llmRules?: FakeRule[];
  obeyInjection?: boolean;
  settings?: Partial<ResearchSettings>;
  pages?: FakePage[];
  rates?: { inMicrosPer1k: number; outMicrosPer1k: number };
  proposer?: HypothesisProposer;
  withProposals?: boolean;
}

export function buildResearchHarness(options: HarnessOptions = {}) {
  const db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  const clock = { now: new Date("2026-11-19T10:00:00.000Z") };
  const now = () => clock.now;
  const settings: ResearchSettings = { ...DEFAULT_RESEARCH_SETTINGS, ...options.settings };
  const scenario = loadScenario(options.scenario ?? "northvale");
  const llm = new FakeLLM(options.llmRules ?? scenario.rules, {
    obeyInjection: options.obeyInjection ?? scenario.obeyInjection,
  });
  const source = new FakeResearchSource(options.pages ?? loadPages());
  const signals = new SignalService(db, {
    excerptMaxChars: 300,
    similarityThreshold: 0.85,
    retentionMonths: 36,
  });
  const rate = options.rates ?? { inMicrosPer1k: 1000, outMicrosPer1k: 5000 };
  const gateway = new LlmGateway({
    db,
    provider: llm,
    models: { extraction: "m-small", synthesis: "m-large" },
    rates: { extraction: rate, synthesis: rate },
    maxRetries: settings.maxRetries,
    now,
    boundary: () => "bnd-test",
  });
  const jobs = new JobService(db, { now });
  const service = new ResearchService(db, jobs, settings);
  const proposals = new HypothesisProposals(
    db,
    gateway,
    (accountId) =>
      Math.max(
        0,
        settings.accountMonthlyCapMicros -
          db.transaction((tx) => accountSpendMicros(tx, accountId, monthStart(now()))),
      ),
    now,
  );
  const runner = new ResearchRunner({
    db,
    source,
    gateway,
    signals,
    settings,
    now,
    proposer: options.proposer ?? (options.withProposals ? proposals : undefined),
  });
  const interpreter = new ProblemInterpreter(db, gateway, settings, now);
  const hypotheses = new HypothesisService(db, settings.hypothesisStaleDays, now);
  const hypothesisReview = new HypothesisReview(db, settings.hypothesisStaleDays);
  const staleness = new HypothesisStaleness(db, settings.hypothesisStaleDays);
  const signalReview = new SignalReview(db);

  for (const a of Object.values(ACCOUNTS)) {
    const at = now().toISOString();
    db.raw
      .prepare(
        "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES (?,?,?,?,?)",
      )
      .run(a.id, a.name, a.name.toLowerCase(), at, at);
    db.raw
      .prepare(
        "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES (?,?,?,?)",
      )
      .run(`cls-${a.id}`, a.id, a.type, at);
    db.raw
      .prepare("INSERT INTO account_domain (id, account_id, domain, created_at) VALUES (?,?,?,?)")
      .run(`dom-${a.id}`, a.id, a.domain, at);
  }
  const addRule = (
    pattern: string,
    kind = "public_org_site",
    signalSourceKind = "official_publication",
    matchType = "host_suffix",
  ) =>
    db.raw
      .prepare(
        "INSERT INTO research_source_rule (id, kind, match_type, pattern, status, signal_source_kind, created_at) VALUES (?,?,?,?, 'enabled', ?, ?)",
      )
      .run(`rule-${pattern}`, kind, matchType, pattern, signalSourceKind, now().toISOString());
  for (const a of Object.values(ACCOUNTS)) addRule(a.domain);
  addRule("evidence.example", "public_regulatory", "official_publication");

  const actor = (over: Partial<ResearchActor> = {}): ResearchActor => ({
    userId: "analyst-1",
    actorType: "human",
    correlationId: "corr-run",
    now,
    ...over,
  });
  const count = (table: string, where = "1=1") =>
    (db.raw.prepare(`SELECT count(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c;
  /** Start a run for an account over the given addresses and execute it. */
  async function runFor(
    accountId: string,
    addresses: string[],
    over: { maxSources?: number; maxCost?: string } = {},
  ) {
    const run = service.startRun(actor(), accountId, {
      sources: addresses.map((address) => ({ address })),
      ...over,
    });
    await runner.execute(run.id);
    return service.get(run.id);
  }
  /** A signal recorded by a person (manual), by default from the official publication source. */
  const signal = (accountId: string, observation: string, over: Record<string, unknown> = {}) =>
    signals.record({ userId: "analyst-1", actorType: "human", correlationId: null, now }, {
      accountId,
      typeKey: "onboarding_delay",
      observation,
      observedAt: now().toISOString(),
      source: {
        sourceId: "default-source-official_publication",
        ref: `https://example.org/${Math.random().toString(36).slice(2)}`,
      },
      ...over,
    } as never).signal;
  const reviewer = (): ResearchActor => ({
    userId: "reviewer-1",
    actorType: "human",
    correlationId: null,
    now,
  });
  const approve = (signalId: string) =>
    signalReview.review(reviewer(), signalId, { decision: "approve" });
  return {
    db,
    clock,
    settings,
    llm,
    source,
    signals,
    gateway,
    jobs,
    service,
    runner,
    actor,
    count,
    runFor,
    addRule,
    now,
    interpreter,
    hypotheses,
    hypothesisReview,
    staleness,
    signalReview,
    signal,
    approve,
    reviewer,
  };
}

export type Harness = ReturnType<typeof buildResearchHarness>;
