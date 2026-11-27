import type { SqliteDatabase } from "@gtm/db";
import {
  AnthropicLLM,
  FakeLLM,
  ManualCaptureSource,
  WebFetchSource,
  type LLMProvider,
  type ResearchSourceProvider,
} from "@gtm/providers";
import type { AppConfig } from "./config/index.js";
import type { JobService } from "./modules/jobs/index.js";
import {
  HypothesisProposals,
  HypothesisReview,
  HypothesisService,
  HypothesisStaleness,
} from "./modules/hypotheses/index.js";
import { LlmGateway } from "./modules/providers/index.js";
import {
  ProblemInterpreter,
  ResearchRunner,
  ResearchSchedules,
  ResearchService,
  ResearchSourceRules,
  monthStart,
  type ResearchSettings,
} from "./modules/research/index.js";
import { accountSpendMicros } from "./modules/research/repository.js";
import type { SignalService } from "./modules/signals/index.js";

// Composition of the research and hypotheses stack (feature 004 task T071). The provider is chosen from
// configuration: `fake` (development and tests; production refuses it in config) or `anthropic`. The source
// provider is manual capture unless an administrator switched web fetch on.

/** Development default for the fake model: valid, empty structured answers (no invented findings). */
export const DEV_FAKE_RULES = [
  { task: "extraction" as const, whenTextIncludes: [""], respond: { findings: [] }, repeat: true },
  { task: "synthesis" as const, whenTextIncludes: [""], respond: { proposals: [] }, repeat: true },
  {
    task: "interpretation" as const,
    whenTextIncludes: [""],
    respond: { matches: [], discoveryQuestions: [], unknowns: [] },
    repeat: true,
  },
];

export interface ResearchStackOptions {
  db: SqliteDatabase;
  config: AppConfig;
  jobs: JobService;
  signals: SignalService;
  llm?: LLMProvider;
  source?: ResearchSourceProvider;
  now?: () => Date;
}

export function researchSettings(config: AppConfig): ResearchSettings {
  return {
    maxSources: config.research.maxSources,
    maxSourcesHard: 25,
    runCapMicros: config.research.runCapMicros,
    accountMonthlyCapMicros: config.research.accountMonthlyCapMicros,
    maxRetries: config.research.maxRetries,
    interpretationCapMicros: config.research.interpretationCapMicros,
    fetchTimeoutMs: config.research.fetchTimeoutMs,
    maxPageBytes: config.research.maxPageBytes,
    hypothesisStaleDays: config.research.hypothesisStaleDays,
  };
}

export function createLlmProvider(config: AppConfig): LLMProvider {
  if (config.llm.provider === "anthropic") return new AnthropicLLM({ apiKey: config.llm.apiKey! });
  return new FakeLLM(DEV_FAKE_RULES);
}

export function createSourceProvider(config: AppConfig): ResearchSourceProvider {
  return config.research.webFetchEnabled ? new WebFetchSource() : new ManualCaptureSource();
}

export function buildResearchStack(o: ResearchStackOptions) {
  const settings = researchSettings(o.config);
  const now = o.now ?? (() => new Date());
  const llm = o.llm ?? createLlmProvider(o.config);
  const source = o.source ?? createSourceProvider(o.config);
  const gateway = new LlmGateway({
    db: o.db,
    provider: llm,
    models: o.config.llm.models,
    rates: o.config.llm.rates,
    maxRetries: settings.maxRetries,
    now,
  });
  const accountRemaining = (accountId: string) =>
    Math.max(
      0,
      settings.accountMonthlyCapMicros -
        o.db.transaction((tx) => accountSpendMicros(tx, accountId, monthStart(now()))),
    );
  const proposals = new HypothesisProposals(o.db, gateway, accountRemaining, now);
  const research = new ResearchService(o.db, o.jobs, settings);
  const runner = new ResearchRunner({
    db: o.db,
    source,
    gateway,
    signals: o.signals,
    settings,
    now,
    proposer: proposals,
  });
  const schedules = new ResearchSchedules(o.db, research);
  const rules = new ResearchSourceRules(o.db, o.config.research.webFetchEnabled);
  const interpreter = new ProblemInterpreter(o.db, gateway, settings, now);
  const hypotheses = new HypothesisService(o.db, settings.hypothesisStaleDays, now);
  const review = new HypothesisReview(o.db, settings.hypothesisStaleDays);
  const staleness = new HypothesisStaleness(o.db, settings.hypothesisStaleDays);
  return {
    settings,
    gateway,
    accountRemaining,
    research,
    runner,
    schedules,
    rules,
    interpreter,
    hypotheses,
    review,
    staleness,
  };
}

export type ResearchStack = ReturnType<typeof buildResearchStack>;
