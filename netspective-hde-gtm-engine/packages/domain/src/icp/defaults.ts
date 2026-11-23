import type { IcpDefinition } from "./definition.js";

// The two default ICP definitions (feature 002 slice): hypotheses agreed with the GTM lead (open
// question #28), bed band unset. ICP 1 is a health information exchange or program operator; ICP 2 is a
// mid-size health system.

export const DEFAULT_ICP_DEFINITIONS: { icp1: IcpDefinition; icp2: IcpDefinition } = {
  icp1: {
    icp: "icp1",
    statusLabel: "hypothesis",
    orgTypes: ["health_information_exchange", "state_medicaid_program_operator"],
    criteria: [
      {
        key: "sender_onboarding_friction",
        label: "Sender onboarding or implementation guide change friction",
        required: true,
        topics: ["sender_onboarding_friction", "ig_change_friction"],
        kind: "evidence",
      },
    ],
    bedBand: null,
  },
  icp2: {
    icp: "icp2",
    statusLabel: "hypothesis",
    orgTypes: ["health_system"],
    criteria: [
      {
        key: "mid_size",
        label: "Mid-size health system",
        required: true,
        topics: ["mid_size_judgement"],
        kind: "size",
      },
      {
        key: "stalled_pilot",
        label: "Stalled data-dependent AI or analytics pilot",
        required: true,
        topics: ["stalled_ai_pilot"],
        kind: "evidence",
      },
      {
        key: "demonstrated_data_problem",
        label: "Demonstrated data problem",
        required: true,
        topics: ["demonstrated_data_problem"],
        kind: "evidence",
      },
    ],
    bedBand: null,
  },
};
