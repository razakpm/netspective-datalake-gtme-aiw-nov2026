import { z } from "zod";

// Typed intake records and the working session request (feature 006, spec FR-024 to FR-027, research R-12).
// Pure. Every schema is strict: there is no field for credentials, production data, a price or a budget, so
// none can be accepted. Texts are bounded. Offer 6 takes exactly ten field NAMES and refuses values.

export const OFFER1_SCHEMA_VERSION = 1;
export const OFFER6_SCHEMA_VERSION = 1;
export const SESSION_DECISIONS_MAX = 5;
export const SESSION_DECISION_MAX_LENGTH = 300;
export const FIELD_NAME_COUNT = 10;
export const FIELD_NAME_MAX_LENGTH = 60;

export type IntakeResult<K extends "offer_1" | "offer_6"> =
  | { ok: true; kind: K; schemaVersion: number; payload: unknown }
  | { ok: false; messages: string[] };

// ---- working session ------------------------------------------------------------------------------

export type DecisionsResult = { ok: true; decisions: string[] } | { ok: false; messages: string[] };

export function validateSessionDecisions(input: readonly string[]): DecisionsResult {
  const decisions = input.map((d) => d.trim());
  const messages: string[] = [];
  if (decisions.length < 1) messages.push("Please list at least one open decision.");
  if (decisions.length > SESSION_DECISIONS_MAX) {
    messages.push(`Please list no more than five open decisions (you gave ${decisions.length}).`);
  }
  decisions.forEach((d, i) => {
    if (d.length < 3) messages.push(`Decision ${i + 1} is too short.`);
    if (d.length > SESSION_DECISION_MAX_LENGTH) {
      messages.push(`Decision ${i + 1} is longer than 300 characters.`);
    }
  });
  return messages.length > 0 ? { ok: false, messages } : { ok: true, decisions };
}

// ---- field names ----------------------------------------------------------------------------------

export type FieldNameCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "empty"
        | "too_long"
        | "email"
        | "long_number"
        | "date_shape"
        | "too_many_words"
        | "sentence"
        | "row_or_quote"
        | "number_token";
    };

const DATE_SHAPE = /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/;

/**
 * An entry must read as a field name. A hypothesis, tuned against tests/fixtures/intake/field-names.json:
 * longer than 60 characters, an email address, a run of six or more digits, a date or time, more than five
 * words, a sentence mark at the end, a comma, bar, semicolon, tab or quote (a record row or a quoted value)
 * and a standalone number of three or more digits all read as a value. The PHI guard still checks every
 * entry for patient-like data on top of this.
 */
export function looksLikeFieldName(entry: string): FieldNameCheck {
  const value = entry.trim();
  if (value === "") return { ok: false, reason: "empty" };
  if (value.length > FIELD_NAME_MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (value.includes("@")) return { ok: false, reason: "email" };
  if (/\d{6,}/.test(value)) return { ok: false, reason: "long_number" };
  if (DATE_SHAPE.test(value)) return { ok: false, reason: "date_shape" };
  if (/[,|;\t"]/.test(value)) return { ok: false, reason: "row_or_quote" };
  if (value.split(/\s+/).length > 5) return { ok: false, reason: "too_many_words" };
  if (/[.!?]$/.test(value)) return { ok: false, reason: "sentence" };
  if (/(^|\s)\d{3,}(\s|$)/.test(value)) return { ok: false, reason: "number_token" };
  return { ok: true };
}

// ---- Offer 1 --------------------------------------------------------------------------------------

export const PROGRAM_TYPES = [
  "health_information_exchange",
  "state_medicaid_program_operator",
  "health_system",
  "other",
] as const;
const YES_NO_UNSURE = z.enum(["yes", "no", "unsure"]);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const Offer1IntakeSchema = z
  .object({
    programType: z.enum(PROGRAM_TYPES),
    organisationName: text(2, 200),
    recentOnboarding: z
      .object({
        senderLabel: text(2, 120),
        formatAndGuide: text(3, 500),
        timelineAndStages: text(3, 500),
      })
      .strict(),
    knownDelays: z.array(text(3, 500)).max(10).optional(),
    attendingRoles: z.array(text(2, 120)).min(1).max(10),
    specsAvailable: YES_NO_UNSURE,
    scrubbedRejectionLogsAvailable: YES_NO_UNSURE,
  })
  .strict();

// ---- Offer 6 --------------------------------------------------------------------------------------

export const Offer6IntakeSchema = z
  .object({
    useCase: text(3, 200),
    pilotOwner: text(2, 120),
    sourceSystems: z.array(text(2, 120)).min(1).max(10),
    fieldNames: z
      .array(z.string().max(500))
      .max(100)
      .superRefine((names, ctx) => {
        if (names.length !== FIELD_NAME_COUNT) {
          ctx.addIssue({
            code: "custom",
            message: `Give exactly ten field names (you gave ${names.length}).`,
          });
          return;
        }
        names.forEach((n, i) => {
          if (!looksLikeFieldName(n).ok) {
            ctx.addIssue({
              code: "custom",
              path: [i],
              message: `Entry ${i + 1} is not a field name. Field names, not values, are needed (for example DOB or patient_id).`,
            });
          }
        });
      }),
    dataLead: text(2, 120),
    fieldQualityConcerns: z.array(text(3, 500)).max(10).optional(),
    interfaceTypes: z.array(text(2, 120)).max(10).optional(),
    attendees: z.array(text(2, 120)).min(1).max(10),
  })
  .strict();

// ---- plain messages -------------------------------------------------------------------------------

const LABELS: Record<string, string> = {
  programType: "program type",
  organisationName: "organisation name",
  recentOnboarding: "the recent sender onboarding",
  "recentOnboarding.senderLabel": "the sender (a label, not a person)",
  "recentOnboarding.formatAndGuide": "the format and implementation guide",
  "recentOnboarding.timelineAndStages": "the timeline and stages",
  knownDelays: "known delays",
  attendingRoles: "attending roles",
  specsAvailable: "whether non-PHI specifications are available",
  scrubbedRejectionLogsAvailable: "whether scrubbed rejection logs are available",
  useCase: "use case",
  pilotOwner: "pilot owner",
  sourceSystems: "source systems",
  fieldNames: "field names",
  dataLead: "data or integration lead",
  fieldQualityConcerns: "field quality concerns",
  interfaceTypes: "interface or message types",
  attendees: "attendees",
};

function plain(issues: readonly z.core.$ZodIssue[]): string[] {
  const out = new Set<string>();
  for (const issue of issues) {
    if (issue.code === "custom") {
      out.add(issue.message);
      continue;
    }
    if (issue.code === "unrecognized_keys") {
      out.add("This form does not take that information. Remove the extra fields.");
      continue;
    }
    const path = issue.path.filter((p): p is string => typeof p === "string");
    const label = LABELS[path.join(".")] ?? LABELS[path[0] ?? ""] ?? "this form";
    out.add(`Please check ${label}.`);
  }
  return [...out];
}

export function validateOffer1(input: unknown): IntakeResult<"offer_1"> {
  const r = Offer1IntakeSchema.safeParse(input);
  return r.success
    ? { ok: true, kind: "offer_1", schemaVersion: OFFER1_SCHEMA_VERSION, payload: r.data }
    : { ok: false, messages: plain(r.error.issues) };
}

export function validateOffer6(input: unknown): IntakeResult<"offer_6"> {
  const r = Offer6IntakeSchema.safeParse(input);
  return r.success
    ? { ok: true, kind: "offer_6", schemaVersion: OFFER6_SCHEMA_VERSION, payload: r.data }
    : { ok: false, messages: plain(r.error.issues) };
}
