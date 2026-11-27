import { z } from "zod";
import { normaliseForQuote } from "../research/verify.js";

// Typed workshop findings and their rules (feature 007, spec FR-018 to FR-029, research R-06 and R-09).
// Pure. A draft may be incomplete; finalising is refused with the list of shortfalls, of which only a
// shortfall of delay sources or of recorded fields can be waived with a reason. Unknown is a status of its
// own and is never merged into gap. There is no field for a price, a budget or a qualification decision.
// The wording constants are hypotheses (open question #53).

export const BOUNDARY_SENTENCE =
  "This free diagnosis covers where the delay is and who can act on it; remediation, scoping and delivery are paid work outside it.";
export const FINDINGS_DISCLAIMER =
  "This view reflects the inputs as described today. It is not a guarantee of model performance.";
export const FINDINGS_SCHEMA_VERSION = 1;
export const DELAY_SOURCES_REQUIRED = 3;
export const FIELDS_REQUIRED = 10;
export const WAIVER_MIN_LENGTH = 10;

export type FindingsKind = "offer_1" | "offer_6";

export const OWNER_CLASSES = ["operator", "sender", "rule_owner"] as const;
export const DELAY_UNITS = ["hours", "days", "weeks"] as const;
export const CONFIRMATIONS = ["confirmed", "not_confirmed", "unknown"] as const;
export const OBSERVATION_STATUSES = ["known_good", "gap", "unknown"] as const;
export const OBSERVATION_DIMENSIONS = [
  "quality",
  "completeness",
  "freshness",
  "provenance",
  "access",
] as const;
export const OVERALL_VIEWS = ["go", "no_go", "conditional"] as const;
export type ObservationDimension = (typeof OBSERVATION_DIMENSIONS)[number];

const text = (max: number) => z.string().max(max);

const DelaySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("quantified"),
      amount: z.number().positive().max(1_000_000),
      unit: z.enum(DELAY_UNITS),
    })
    .strict(),
  z.object({ kind: z.literal("not_quantified") }).strict(),
]);

const DelaySourceSchema = z
  .object({
    description: text(300),
    ownerClass: z.enum(OWNER_CLASSES).nullable(),
    delay: DelaySchema.nullable(),
    confirmation: z.enum(CONFIRMATIONS),
    /** Written by the server only. */
    confirmedBy: text(100).optional(),
    confirmedAt: text(40).optional(),
  })
  .strict();

export const Offer1FindingsSchema = z
  .object({
    flowSummary: text(1000),
    delaySources: z.array(DelaySourceSchema).max(DELAY_SOURCES_REQUIRED),
    unknowns: z.array(text(300)).max(10),
    suggestedNextStep: text(500),
    boundaryNote: text(600),
  })
  .strict();

const ObservationSchema = z
  .object({ status: z.enum(OBSERVATION_STATUSES).nullable(), note: text(300) })
  .strict();

const FieldTraceSchema = z
  .object({
    intakeName: text(60),
    name: z.string().min(1).max(60),
    renameReason: text(300),
    sourceSystem: text(120),
    sourceInterface: text(120),
    observations: z
      .object({
        quality: ObservationSchema,
        completeness: ObservationSchema,
        freshness: ObservationSchema,
        provenance: ObservationSchema,
        access: ObservationSchema,
      })
      .strict(),
  })
  .strict();

export const Offer6FindingsSchema = z
  .object({
    fields: z.array(FieldTraceSchema).length(FIELDS_REQUIRED),
    overall: z
      .object({
        view: z.enum(OVERALL_VIEWS).nullable(),
        dependsOnUnknowns: z
          .array(z.object({ field: text(60), dimension: z.enum(OBSERVATION_DIMENSIONS) }).strict())
          .max(20),
        reason: text(500),
      })
      .strict(),
    disclaimer: text(300),
    inputAuditScope: z
      .object({ useCase: text(200), sources: z.array(z.string().min(1).max(120)).max(2) })
      .strict(),
  })
  .strict();

export type Offer1Findings = z.infer<typeof Offer1FindingsSchema>;
export type Offer6Findings = z.infer<typeof Offer6FindingsSchema>;
export type FieldTrace = Offer6Findings["fields"][number];
export type FindingsContent = Offer1Findings | Offer6Findings;

export const findingsSchemaFor = (kind: FindingsKind) =>
  kind === "offer_1" ? Offer1FindingsSchema : Offer6FindingsSchema;

// ---- new drafts -----------------------------------------------------------------------------------

export const newOffer1Draft = (): Offer1Findings => ({
  flowSummary: "",
  delaySources: [],
  unknowns: [],
  suggestedNextStep: "",
  boundaryNote: BOUNDARY_SENTENCE,
});

const blank = () => ({ status: null, note: "" });

/** The intake's ten names, with nothing recorded: "unknown" is something a person chooses. */
export const newOffer6Draft = (intakeNames: readonly string[]): Offer6Findings => ({
  fields: intakeNames.map((name) => ({
    intakeName: name,
    name,
    renameReason: "",
    sourceSystem: "",
    sourceInterface: "",
    observations: {
      quality: blank(),
      completeness: blank(),
      freshness: blank(),
      provenance: blank(),
      access: blank(),
    },
  })),
  overall: { view: null, dependsOnUnknowns: [], reason: "" },
  disclaimer: FINDINGS_DISCLAIMER,
  inputAuditScope: { useCase: "", sources: [] },
});

// ---- unknown, gap and not recorded ----------------------------------------------------------------

export interface FieldSummary {
  knownGood: number;
  gap: number;
  unknown: number;
  notRecorded: number;
}

export function summariseFields(fields: readonly FieldTrace[]): FieldSummary {
  const summary: FieldSummary = { knownGood: 0, gap: 0, unknown: 0, notRecorded: 0 };
  for (const field of fields) {
    for (const dimension of OBSERVATION_DIMENSIONS) {
      const status = field.observations[dimension].status;
      if (status === "known_good") summary.knownGood += 1;
      else if (status === "gap") summary.gap += 1;
      else if (status === "unknown") summary.unknown += 1;
      else summary.notRecorded += 1;
    }
  }
  return summary;
}

export const unknownObservations = (
  fields: readonly FieldTrace[],
): { field: string; dimension: ObservationDimension }[] =>
  fields.flatMap((f) =>
    OBSERVATION_DIMENSIONS.filter((d) => f.observations[d].status === "unknown").map((d) => ({
      field: f.intakeName,
      dimension: d,
    })),
  );

export const isRecordedField = (field: FieldTrace): boolean =>
  OBSERVATION_DIMENSIONS.every((d) => field.observations[d].status !== null);

export const renamedFields = (content: Offer6Findings): { intakeName: string; name: string }[] =>
  content.fields
    .filter((f) => f.name !== f.intakeName)
    .map((f) => ({ intakeName: f.intakeName, name: f.name }));

// ---- finalisation ---------------------------------------------------------------------------------

export type ShortfallCode =
  | "flow_summary_missing"
  | "too_few_delay_sources"
  | "too_many_delay_sources"
  | "delay_description_missing"
  | "owner_class_missing"
  | "delay_missing"
  | "next_step_missing"
  | "boundary_note_missing"
  | "field_list_fixed"
  | "too_few_fields"
  | "rename_reason_missing"
  | "overall_view_missing"
  | "unknowns_not_listed"
  | "unknown_dependency_invalid"
  | "go_reason_missing"
  | "disclaimer_changed"
  | "scope_missing"
  | "scope_too_many_sources";

export interface Shortfall {
  code: ShortfallCode;
  waivable: boolean;
  message: string;
}

const MESSAGES: Record<ShortfallCode, string> = {
  flow_summary_missing: "Summarise the onboarding flow.",
  too_few_delay_sources: "Three delay sources are expected. Give a reason to finalise with fewer.",
  too_many_delay_sources: "Choose the three biggest delay sources.",
  delay_description_missing: "Describe every delay source.",
  owner_class_missing:
    "Say who can act on every delay source: the operator, the sender or the rule owner.",
  delay_missing: "Give every delay as an amount, or mark it as not quantified.",
  next_step_missing: "Suggest a next step.",
  boundary_note_missing: "The boundary note must begin with the standard sentence.",
  field_list_fixed: "The fields are the ten named in the intake, in that order.",
  too_few_fields:
    "All ten fields are expected to be recorded. Give a reason to finalise with fewer.",
  rename_reason_missing: "Give a reason for every changed field name.",
  overall_view_missing: "Choose go, no-go or conditional.",
  unknowns_not_listed: "List the unknowns the overall view depends on.",
  unknown_dependency_invalid: "Only an unknown or unrecorded observation can be listed.",
  go_reason_missing: "A go view with something unknown or not recorded needs the reason in words.",
  disclaimer_changed: "The disclaimer is fixed.",
  scope_missing: "Draft the scope: one use case and one or two sources.",
  scope_too_many_sources: "The scope names at most two sources.",
};
const WAIVABLE: ReadonlySet<ShortfallCode> = new Set(["too_few_delay_sources", "too_few_fields"]);
const empty = (value: string) => value.trim() === "";

function offer1Codes(c: Offer1Findings): ShortfallCode[] {
  const codes: ShortfallCode[] = [];
  if (empty(c.flowSummary)) codes.push("flow_summary_missing");
  if (c.delaySources.length < DELAY_SOURCES_REQUIRED) codes.push("too_few_delay_sources");
  if (c.delaySources.length > DELAY_SOURCES_REQUIRED) codes.push("too_many_delay_sources");
  if (c.delaySources.some((s) => empty(s.description))) codes.push("delay_description_missing");
  if (c.delaySources.some((s) => s.ownerClass === null)) codes.push("owner_class_missing");
  if (c.delaySources.some((s) => s.delay === null)) codes.push("delay_missing");
  if (empty(c.suggestedNextStep)) codes.push("next_step_missing");
  if (!c.boundaryNote.startsWith(BOUNDARY_SENTENCE)) codes.push("boundary_note_missing");
  return codes;
}

function offer6Codes(c: Offer6Findings, intakeNames?: readonly string[]): ShortfallCode[] {
  const codes: ShortfallCode[] = [];
  if (
    c.fields.length !== FIELDS_REQUIRED ||
    (intakeNames !== undefined && c.fields.some((f, i) => f.intakeName !== intakeNames[i]))
  ) {
    codes.push("field_list_fixed");
  }
  if (c.fields.filter(isRecordedField).length < FIELDS_REQUIRED) codes.push("too_few_fields");
  if (c.fields.some((f) => f.name !== f.intakeName && f.renameReason.trim().length < 3)) {
    codes.push("rename_reason_missing");
  }
  const open = c.fields.flatMap((f) =>
    OBSERVATION_DIMENSIONS.filter((d) => {
      const status = f.observations[d].status;
      return status === "unknown" || status === null;
    }).map((d) => `${f.intakeName}/${d}`),
  );
  const { view, dependsOnUnknowns, reason } = c.overall;
  if (view === null) codes.push("overall_view_missing");
  if (view !== null && dependsOnUnknowns.length === 0 && unknownObservations(c.fields).length > 0) {
    codes.push("unknowns_not_listed");
  }
  if (dependsOnUnknowns.some((u) => !open.includes(`${u.field}/${u.dimension}`))) {
    codes.push("unknown_dependency_invalid");
  }
  if (view === "go" && open.length > 0 && empty(reason)) codes.push("go_reason_missing");
  if (c.disclaimer !== FINDINGS_DISCLAIMER) codes.push("disclaimer_changed");
  const { useCase, sources } = c.inputAuditScope;
  if (empty(useCase) || sources.length === 0) codes.push("scope_missing");
  if (sources.length > 2) codes.push("scope_too_many_sources");
  return codes;
}

/** Everything still missing before the findings can be finalised. */
export function findingsShortfalls(
  kind: FindingsKind,
  content: FindingsContent,
  intakeNames?: readonly string[],
): Shortfall[] {
  const codes =
    kind === "offer_1"
      ? offer1Codes(content as Offer1Findings)
      : offer6Codes(content as Offer6Findings, intakeNames);
  return codes.map((code) => ({ code, waivable: WAIVABLE.has(code), message: MESSAGES[code] }));
}

/** The shortfalls that still block, given the recorded waiver reason. */
export function blockingShortfalls(
  shortfalls: readonly Shortfall[],
  waiverReason: string | undefined,
): Shortfall[] {
  const waived = (waiverReason?.trim().length ?? 0) >= WAIVER_MIN_LENGTH;
  return shortfalls.filter((s) => !(s.waivable && waived));
}

// ---- what a finding may not say -------------------------------------------------------------------

export type TextProblem = "price_stated" | "guarantee_stated" | "sample_record_not_accepted";

const PRICE = [
  /[$€£]\s?\d/,
  /\b\d[\d,.]*\s?(usd|eur|gbp|dollars?|euros?|pounds?)\b/i,
  /\b(price[ds]?|pricing|budget(s|ed)?|fees?)\b/i,
];
const GUARANTEE = /\bguarantee(s|d|ing)?\b/i;

function looksLikeRecord(value: string): boolean {
  const count = (line: string, mark: string) => line.split(mark).length - 1;
  const lines = value.split(/\r?\n/);
  if (lines.some((line) => count(line, "\t") >= 3 || count(line, "|") >= 3)) return true;
  return lines.filter((line) => count(line, ",") >= 3 && !/[.!?]\s*$/.test(line)).length >= 2;
}

export function findingsTextProblems(texts: readonly string[]): TextProblem[] {
  const found = new Set<TextProblem>();
  for (const value of texts) {
    if (PRICE.some((p) => p.test(value))) found.add("price_stated");
    if (GUARANTEE.test(value)) found.add("guarantee_stated");
    if (looksLikeRecord(value)) found.add("sample_record_not_accepted");
  }
  return [...found];
}

/**
 * The words a person typed. The fixed sentences (boundary and disclaimer) and the buyer's own field names
 * are not among them.
 */
export function findingsTexts(kind: FindingsKind, content: FindingsContent): string[] {
  if (kind === "offer_1") {
    const c = content as Offer1Findings;
    return [
      c.flowSummary,
      ...c.delaySources.map((s) => s.description),
      ...c.unknowns,
      c.suggestedNextStep,
      c.boundaryNote.replace(BOUNDARY_SENTENCE, ""),
    ];
  }
  const c = content as Offer6Findings;
  return [
    ...c.fields.flatMap((f) => [
      f.name === f.intakeName ? "" : f.name,
      f.renameReason,
      f.sourceSystem,
      f.sourceInterface,
      ...OBSERVATION_DIMENSIONS.map((d) => f.observations[d].note),
    ]),
    c.overall.reason,
    c.inputAuditScope.useCase,
    ...c.inputAuditScope.sources,
  ];
}

/** A scope names what is looked at, not how long it takes. */
export const scopeDurationStated = (scope: Offer6Findings["inputAuditScope"]): boolean =>
  [scope.useCase, ...scope.sources].some((value) =>
    /\b\d+\s*-?\s*(hours?|days?|weeks?|months?|years?)\b/i.test(value),
  );

// ---- support for suggestions from notes -----------------------------------------------------------

export interface DraftItem {
  path: string;
  value: string | number;
  supportingText: string;
  interpretation: boolean;
}

const numbersIn = (value: string): string[] =>
  (value.normalize("NFKC").match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
const words = (value: string): string => ` ${normaliseForQuote(value)} `;
const OFFER1_PATH = /^(flowSummary|suggestedNextStep|unknowns\.\d+|delaySources\.[0-2]\..+)$/;

/**
 * Keep only the suggestions the notes bear out (spec FR-029): the quote is in the notes; every number, and
 * every source system, interface or field name, in the value is in the quote; and the path belongs to this
 * kind of findings. An owner class or a status is marked as an interpretation for a person to accept.
 */
export function supportDraftItems(
  items: readonly DraftItem[],
  context: {
    kind: FindingsKind;
    notes: string;
    /** Offer 6: the intake's field names, in order. */
    fieldNames: readonly string[];
    /** Source system and interface names known from the intake. */
    knownNames: readonly string[];
  },
): { items: DraftItem[]; dropped: number } {
  const notes = words(context.notes);
  const names = [...context.knownNames, ...context.fieldNames]
    .map((n) => words(n))
    .filter((n) => n.trim() !== "");
  const seen = new Set<string>();
  const kept = items.filter((item) => {
    if (seen.has(item.path)) return false;
    if (context.kind === "offer_1") {
      if (!OFFER1_PATH.test(item.path)) return false;
    } else {
      const index = /^fields\.(\d)\./.exec(item.path)?.[1];
      if (index === undefined || Number(index) >= context.fieldNames.length) return false;
    }
    const quote = words(item.supportingText);
    if (quote.trim() === "" || !notes.includes(quote)) return false;
    const value = String(item.value);
    const quoted = new Set(numbersIn(item.supportingText));
    if (numbersIn(value).some((n) => !quoted.has(n))) return false;
    const said = words(value);
    if (/\.source(System|Interface)$/.test(item.path) && !quote.includes(said)) return false;
    if (names.some((name) => said.includes(name) && !quote.includes(name))) return false;
    if (findingsTextProblems([value]).length > 0) return false;
    seen.add(item.path);
    return true;
  });
  return {
    items: kept.map((item) => ({
      ...item,
      interpretation: /\.(ownerClass|status)$/.test(item.path),
    })),
    dropped: items.length - kept.length,
  };
}
