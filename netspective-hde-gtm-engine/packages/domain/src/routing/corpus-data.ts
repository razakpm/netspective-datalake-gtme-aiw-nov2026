import type { Corpus } from "./corpus.js";
import corpus from "./corpus.json" with { type: "json" };

// The packaged routing case corpus (research R-07): read by rule set activation in a deployed container,
// so the gate does not depend on the repository's test folder.
export const ROUTING_CORPUS = corpus as unknown as Corpus;
