import {
  FINDINGS_DISCLAIMER,
  findingsTextProblems,
  OBSERVATION_DIMENSIONS,
  summariseFields,
  type FindingsContent,
  type FindingsKind,
  type Offer1Findings,
  type Offer6Findings,
} from "./findings.js";

// The one-page buyer output (feature 007, spec FR-030 to FR-032, research R-12). Pure. The page is built
// from finalised findings and nothing else. Its findings, unknowns, boundary and disclaimer sections are
// generated here and cannot be edited, which is what stops an unknown being worded as a gap or an
// unconfirmed delay as confirmed: these are the only words that do so. The scope wording is a hypothesis.

export interface OutputSections {
  title: string;
  organisation: string;
  offerName: string;
  date: string;
  summary: string;
  findings: string;
  unknowns: string;
  nextStep: string;
  inScope: string[];
  outOfScope: string[];
  boundaryNote?: string | undefined;
  disclaimer?: string | undefined;
}

export const EDITABLE_SECTIONS = ["title", "summary", "nextStep", "inScope", "outOfScope"] as const;
const GENERATED = [
  "organisation",
  "offerName",
  "date",
  "findings",
  "unknowns",
  "boundaryNote",
] as const;
export const SUMMARY_MAX = 1200;
export const FINDINGS_MAX = 1200;
export const UNKNOWNS_MAX = 600;
export const NEXT_STEP_MAX = 500;

const SCOPE: Record<FindingsKind, { inScope: string[]; outOfScope: string[] }> = {
  offer_1: {
    inScope: ["Where onboarding is delayed and who can act on each delay", "A suggested next step"],
    outOfScope: [
      "Fixing or changing any interface or rule",
      "Scoping, estimates and delivery, which are paid work",
      "Review of patient data or production data",
    ],
  },
  offer_6: {
    inScope: [
      "Tracing the ten named fields to their sources",
      "A draft scope of one use case and one or two sources",
    ],
    outOfScope: [
      "Building or changing data pipelines",
      "Any view on how a model will perform",
      "Scoping, estimates and delivery, which are paid work",
      "Review of patient data or field values",
    ],
  },
};

const OWNERS = {
  operator: "the operator",
  sender: "the sender",
  rule_owner: "the rule owner",
} as const;
const CONFIRMED = {
  confirmed: "confirmed by the buyer",
  not_confirmed: "not confirmed",
  unknown: "confirmation unknown",
} as const;
const VIEWS = { go: "go", no_go: "no-go", conditional: "conditional" } as const;

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
const shortfallLine = (waiverReason: string | null) =>
  waiverReason ? `Finalised with a recorded shortfall: ${waiverReason}` : null;

/** Join entries into one line of at most `max`, saying how many did not fit. */
function listWithin(label: string, entries: string[], max: number): string {
  if (entries.length === 0) return "";
  const full = `${label}: ${entries.join("; ")}.`;
  if (full.length <= max) return full;
  for (let kept = entries.length - 1; kept >= 0; kept--) {
    const line = `${label}: ${entries.slice(0, kept).join("; ")} and ${entries.length - kept} more.`;
    if (line.length <= max) return line;
  }
  return `${label}: ${entries.length} more.`;
}

function offer1Findings(c: Offer1Findings, waiverReason: string | null): string {
  const waiver = shortfallLine(waiverReason);
  const room = Math.floor(
    (FINDINGS_MAX - (waiver?.length ?? 0)) / Math.max(1, c.delaySources.length),
  );
  const lines = c.delaySources.map((source, i) => {
    const delay =
      source.delay?.kind === "quantified"
        ? `${source.delay.amount} ${source.delay.unit}`
        : "not quantified";
    const tail = ` Can be addressed by ${source.ownerClass ? OWNERS[source.ownerClass] : "nobody named"}; delay: ${delay} (${CONFIRMED[source.confirmation]}).`;
    return `${i + 1}. ${clip(source.description, room - tail.length - 5)}${tail}`;
  });
  return clip([...lines, ...(waiver ? [waiver] : [])].join("\n"), FINDINGS_MAX);
}

function observations(c: Offer6Findings, status: "gap" | "unknown" | null): string[] {
  return c.fields.flatMap((field) => {
    const dimensions = OBSERVATION_DIMENSIONS.filter(
      (d) => field.observations[d].status === status,
    );
    return dimensions.length > 0 ? [`${field.name} (${dimensions.join(", ")})`] : [];
  });
}

function offer6Findings(c: Offer6Findings, waiverReason: string | null): string {
  const counts = summariseFields(c.fields);
  const waiver = shortfallLine(waiverReason);
  const head = [
    `Overall view: ${c.overall.view ? VIEWS[c.overall.view] : "not chosen"}.`,
    `Observations: ${counts.knownGood} known good, ${counts.gap} with a gap.`,
  ];
  const used = head.join("\n").length + (waiver?.length ?? 0) + 4;
  const gaps = listWithin("Gaps", observations(c, "gap"), FINDINGS_MAX - used);
  return clip(
    [...head, ...(gaps ? [gaps] : []), ...(waiver ? [waiver] : [])].join("\n"),
    FINDINGS_MAX,
  );
}

function offer6Unknowns(c: Offer6Findings): string {
  const unknown = observations(c, "unknown");
  const unrecorded = observations(c, null);
  const share = unknown.length > 0 && unrecorded.length > 0 ? UNKNOWNS_MAX / 2 : UNKNOWNS_MAX;
  const lines = [
    listWithin("Unknown", unknown, share - 1),
    listWithin("Not recorded", unrecorded, share - 1),
  ].filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : "Nothing was recorded as unknown.";
}

export function buildOutputSections(input: {
  kind: FindingsKind;
  content: FindingsContent;
  waiverReason: string | null;
  organisation: string;
  offerName: string;
  date: string;
}): OutputSections {
  const { kind, waiverReason } = input;
  const common = {
    title: clip(`${input.offerName}: workshop findings`, 200),
    organisation: input.organisation,
    offerName: input.offerName,
    date: input.date,
    inScope: [...SCOPE[kind].inScope],
    outOfScope: [...SCOPE[kind].outOfScope],
  };
  if (kind === "offer_1") {
    const c = input.content as Offer1Findings;
    return {
      ...common,
      summary: clip(c.flowSummary, SUMMARY_MAX),
      findings: offer1Findings(c, waiverReason),
      unknowns:
        c.unknowns.length > 0
          ? listWithin("Unknown", c.unknowns, UNKNOWNS_MAX)
          : "Nothing was recorded as unknown.",
      nextStep: clip(c.suggestedNextStep, NEXT_STEP_MAX),
      boundaryNote: c.boundaryNote,
    };
  }
  const c = input.content as Offer6Findings;
  const { useCase, sources } = c.inputAuditScope;
  return {
    ...common,
    summary: clip(c.overall.reason, SUMMARY_MAX),
    findings: offer6Findings(c, waiverReason),
    unknowns: offer6Unknowns(c),
    nextStep: clip(`Input Audit: ${useCase}, using ${sources.join(" and ")}.`, NEXT_STEP_MAX),
    disclaimer: FINDINGS_DISCLAIMER,
  };
}

export function generatedSectionsOf(
  sections: OutputSections,
): Partial<Pick<OutputSections, (typeof GENERATED)[number]>> {
  return Object.fromEntries(
    GENERATED.filter((key) => sections[key] !== undefined).map((key) => [key, sections[key]]),
  );
}

const allTexts = (s: OutputSections): string[] => [
  s.title,
  s.organisation,
  s.offerName,
  s.date,
  s.summary,
  s.findings,
  s.unknowns,
  s.nextStep,
  ...s.inScope,
  ...s.outOfScope,
  s.boundaryNote ?? "",
  s.disclaimer ?? "",
];

export const outputTextLength = (sections: OutputSections): number =>
  allTexts(sections).reduce((total, value) => total + value.length, 0);

/** The words a person can change, and those built from their findings: what claim checks read. */
export const editableTexts = (s: OutputSections): string[] => [
  s.title,
  s.summary,
  s.nextStep,
  ...s.inScope,
  ...s.outOfScope,
];

export type OutputProblemCode =
  | "scope_section_missing"
  | "disclaimer_missing"
  | "over_one_page"
  | "price_stated"
  | "generated_section_changed"
  | "restricted_wording";

export const OUTPUT_PROBLEMS: Record<OutputProblemCode, string> = {
  scope_section_missing: "The page needs both an in-scope and an out-of-scope section.",
  disclaimer_missing: "The page needs the fixed disclaimer, unchanged.",
  over_one_page: "The page is too long. Shorten the summary, the next step or the scope lists.",
  price_stated: "The page does not state a price, a fee or a budget.",
  generated_section_changed:
    "The findings, unknowns and boundary sections must match the findings they came from.",
  restricted_wording: "The page uses restricted wording that no approved claim covers.",
};

/** Everything that stops approval, apart from the claim check, which needs the claim records. */
export function outputProblems(
  sections: OutputSections,
  context: { generated: OutputSections; maxChars: number },
): { code: OutputProblemCode; message: string }[] {
  const codes: OutputProblemCode[] = [];
  const filled = (list: string[]) => list.length > 0 && list.every((item) => item.trim() !== "");
  if (!filled(sections.inScope) || !filled(sections.outOfScope)) {
    codes.push("scope_section_missing");
  }
  if (sections.disclaimer !== context.generated.disclaimer) codes.push("disclaimer_missing");
  if (outputTextLength(sections) > context.maxChars) codes.push("over_one_page");
  if (findingsTextProblems(editableTexts(sections)).includes("price_stated")) {
    codes.push("price_stated");
  }
  if (GENERATED.some((key) => sections[key] !== context.generated[key])) {
    codes.push("generated_section_changed");
  }
  return codes.map((code) => ({ code, message: OUTPUT_PROBLEMS[code] }));
}

// ---- the page ---------------------------------------------------------------------------------------

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const paragraphs = (value: string) =>
  value
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
const section = (heading: string, body: string) =>
  body ? `<section><h2>${heading}</h2>${body}</section>` : "";
const list = (items: string[]) =>
  `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;

/** A self-contained page: escaped text only, no script, link, image or remote resource. */
export function renderOutputHtml(s: OutputSections): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(s.title)}</title>`,
    "<style>@page{size:A4;margin:16mm}body{font:10.5pt/1.35 sans-serif;color:#111}h1{font-size:16pt;margin:0 0 2pt}h2{font-size:11.5pt;margin:9pt 0 3pt}p,ul{margin:0 0 3pt}.meta{color:#444}.note{font-size:9pt;color:#333;margin-top:8pt}</style>",
    "</head><body>",
    `<h1>${escapeHtml(s.title)}</h1>`,
    `<p class="meta">${escapeHtml(`${s.organisation} · ${s.offerName} · ${s.date}`)}</p>`,
    section("Summary", paragraphs(s.summary)),
    section("Findings", paragraphs(s.findings)),
    section("Unknowns", paragraphs(s.unknowns)),
    section("Next step", paragraphs(s.nextStep)),
    section("In scope", list(s.inScope)),
    section("Out of scope", list(s.outOfScope)),
    s.boundaryNote ? `<div class="note">${paragraphs(s.boundaryNote)}</div>` : "",
    s.disclaimer ? `<div class="note">${paragraphs(s.disclaimer)}</div>` : "",
    "</body></html>",
  ].join("");
}
