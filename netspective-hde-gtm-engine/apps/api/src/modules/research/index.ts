// Public entry point of the research module. Other modules import only this file or react to its events.
export { ResearchService, runView, type RunView, type StartInput } from "./service.js";
export { ResearchRunner, type HypothesisProposer, type RunnerDeps } from "./runner.js";
export {
  DEFAULT_RESEARCH_SETTINGS,
  monthStart,
  type ResearchActor,
  type ResearchSettings,
} from "./settings.js";
