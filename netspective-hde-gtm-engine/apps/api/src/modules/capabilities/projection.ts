import type { CapabilityRow } from "./repository.js";

// The only function that builds an outward-facing capability view (feature 005, research R-10). It copies
// an explicit whitelist of attributes, so internal delivery examples can never reach a public output,
// whatever else an input object carries.

export interface PublicCapability {
  slot: number;
  name: string | null;
  description: string | null;
  inputTypes: string[] | null;
  outputTypes: string[] | null;
  buyerProblems: string[] | null;
  limitations: string[] | null;
}

type PublicSource = Pick<
  CapabilityRow,
  "slot" | "name" | "description" | "inputTypes" | "outputTypes" | "buyerProblems" | "limitations"
>;

export function toPublicCapability(c: PublicSource): PublicCapability {
  return {
    slot: c.slot,
    name: c.name,
    description: c.description,
    inputTypes: c.inputTypes,
    outputTypes: c.outputTypes,
    buyerProblems: c.buyerProblems,
    limitations: c.limitations,
  };
}
