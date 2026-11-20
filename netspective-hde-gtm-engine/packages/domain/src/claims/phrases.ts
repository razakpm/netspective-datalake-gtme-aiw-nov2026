import type { PhraseRule } from "./types.js";

// The default restricted phrase list (research R-06; version 1 is seeded from it). Every rule id is the
// id the corpus in tests/fixtures/claims/corpus.json expects. The class of "guarantee" and the outcome
// words behind the percentage rule are hypotheses (open question #48). Customer identity cannot be
// matched by naming a customer; only the fixed wording below is flagged (spec FR-005).

export const DEFAULT_PHRASE_RULES: readonly PhraseRule[] = [
  { id: "ai-ready", class: "ai_ready", kind: "phrase", phrases: ["AI-ready"] },

  { id: "sla", class: "sla_rto", kind: "acronym", phrases: ["SLA"] },
  { id: "rto", class: "sla_rto", kind: "acronym", phrases: ["RTO"] },
  { id: "rpo", class: "sla_rto", kind: "acronym", phrases: ["RPO"] },
  {
    id: "sla-dotted",
    class: "sla_rto",
    kind: "pattern",
    pattern: "(?<![\\p{L}\\p{N}])S\\.L\\.A\\.",
  },
  {
    id: "service-level-agreement",
    class: "sla_rto",
    kind: "phrase",
    phrases: ["service level agreement", "recovery time objective", "recovery point objective"],
  },

  { id: "soc2", class: "certification", kind: "acronym", phrases: ["SOC 2"] },
  { id: "certified", class: "certification", kind: "phrase", phrases: ["certified"] },

  { id: "guarantee", class: "quantified_outcome", kind: "phrase", phrases: ["guarantee"] },
  { id: "guarantees", class: "quantified_outcome", kind: "phrase", phrases: ["guarantees"] },
  { id: "guaranteed", class: "quantified_outcome", kind: "phrase", phrases: ["guaranteed"] },
  {
    id: "outcome-percentage",
    class: "quantified_outcome",
    kind: "outcome_percentage",
    terms: [
      "reduc",
      "improv",
      "increas",
      "faster",
      "uptime",
      "sav",
      "cut",
      "boost",
      "grow",
      "lower",
      "accelerat",
    ],
    window: 5,
  },

  {
    id: "hipaa-compliant",
    class: "legal_regulatory_compliance",
    kind: "phrase",
    phrases: ["HIPAA compliant"],
  },

  {
    id: "production-ready",
    class: "production_status",
    kind: "phrase",
    phrases: ["production-ready"],
  },

  {
    id: "tenant-isolation",
    class: "tenant_isolation",
    kind: "phrase",
    phrases: ["multi-tenant isolation", "tenant isolation"],
  },

  { id: "case-study", class: "customer_identity", kind: "phrase", phrases: ["case study"] },
  { id: "customer-story", class: "customer_identity", kind: "phrase", phrases: ["customer story"] },
  { id: "success-story", class: "customer_identity", kind: "phrase", phrases: ["success story"] },
  { id: "our-client", class: "customer_identity", kind: "phrase", phrases: ["our client"] },
  { id: "named-customer", class: "customer_identity", kind: "phrase", phrases: ["named customer"] },
];
