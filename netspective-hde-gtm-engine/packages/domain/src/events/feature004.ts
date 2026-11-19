import { z } from "zod";

// Feature 004 event payloads (data-model.md "Events"). Identifiers and counts only: no statement, quote,
// address or note text (spec FR-039). Strict schemas so an extra text field cannot slip in.

export const AccountResearchedPayload = z
  .object({
    run_id: z.string().min(1),
    account_id: z.string().min(1),
    state: z.enum(["completed", "budget_reached"]),
    signals_created: z.number().int().min(0),
    injection_flags: z.number().int().min(0),
    cost_micros: z.number().int().min(0),
  })
  .strict();

export const HypothesisCreatedPayload = z
  .object({
    hypothesis_id: z.string().min(1),
    account_id: z.string().min(1),
    origin: z.enum(["analyst", "ai"]),
  })
  .strict();

export const HypothesisUpdatedPayload = z
  .object({
    hypothesis_id: z.string().min(1),
    account_id: z.string().min(1),
    change: z.enum(["status", "stale", "edit", "link", "flag"]),
    status: z.enum(["untested", "strengthening", "weakening", "validated", "rejected", "stale"]),
  })
  .strict();

export const FEATURE004_EVENT_PAYLOADS = {
  "account.researched": AccountResearchedPayload,
  "hypothesis.created": HypothesisCreatedPayload,
  "hypothesis.updated": HypothesisUpdatedPayload,
} as const;

export type AccountResearched = z.infer<typeof AccountResearchedPayload>;
export const toAccountResearchedPayload = (p: AccountResearched): AccountResearched =>
  AccountResearchedPayload.parse(p);
export type HypothesisCreated = z.infer<typeof HypothesisCreatedPayload>;
export const toHypothesisCreatedPayload = (p: HypothesisCreated): HypothesisCreated =>
  HypothesisCreatedPayload.parse(p);
export type HypothesisUpdated = z.infer<typeof HypothesisUpdatedPayload>;
export const toHypothesisUpdatedPayload = (p: HypothesisUpdated): HypothesisUpdated =>
  HypothesisUpdatedPayload.parse(p);
