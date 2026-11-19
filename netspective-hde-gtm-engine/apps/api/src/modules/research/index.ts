// Public entry point of the research module. Other modules import only this file or react to its events.
export { ResearchService, runView, type RunView, type StartInput } from "./service.js";
export { ResearchRunner, type HypothesisProposer, type RunnerDeps } from "./runner.js";
export {
  DEFAULT_RESEARCH_SETTINGS,
  monthStart,
  type ResearchActor,
  type ResearchSettings,
} from "./settings.js";
export { accountFacts, type AccountFacts } from "./repository.js";
export { ProblemInterpreter, type InterpretationView } from "./interpret.js";
export { ResearchSourceRules, RULE_KINDS, type RuleView } from "./sources.js";
export { ResearchSchedules, type ScheduleView } from "./schedule.js";
export { registerResearchRoutes, type ResearchRouteDeps } from "./routes.js";
