// Deterministic PHI and credential detectors (constitution Principles IV and IX). Plain code: no
// network, no model, no provider. Detectors return rule ids only and never the text they matched.
// Changing any rule changes GUARD_VERSION (see guard.ts) so decisions stay attributable.
//
// The stance is deliberately conservative: a false positive goes to a human reviewer, a false negative
// is a privacy incident. Field names and schemas alone (no values) are allowed, because workshops
// legitimately discuss them (docs/context/01-guardrails.md, "Data boundary").

export interface TextRule {
  id: string;
  description: string;
  matches(text: string): boolean;
}

// ---- helpers ------------------------------------------------------------------------------------

const NAME_WORD = "[A-Z][a-z'’-]{1,}";
const LABELLED_NAME = new RegExp(
  `(?:[Pp]atient|PATIENT|[Nn]ame|NAME|[Mm]ember|[Ss]ubscriber)\\s*(?:[Nn]ame)?\\s*[:=]\\s*${NAME_WORD}(?:,?\\s+${NAME_WORD}){1,2}`,
);
const CAPITALISED_PAIR = new RegExp(`\\b(${NAME_WORD}),?\\s+(${NAME_WORD})\\b`, "g");

// Capitalised words that appear in labels and headings, so "Medical Record" is not a person name.
const NOT_NAME_WORDS = new Set([
  "Medical",
  "Record",
  "Records",
  "Number",
  "Date",
  "Birth",
  "Patient",
  "Name",
  "Member",
  "Subscriber",
  "Born",
  "Health",
  "Hospital",
  "Clinic",
  "Care",
  "Data",
  "The",
  "This",
  "That",
  "And",
  "For",
  "With",
  "Admitted",
  "Follow",
  "Due",
]);

function hasNameNear(text: string, start: number, end: number, window = 100): boolean {
  const slice = text.slice(Math.max(0, start - window), Math.min(text.length, end + window));
  if (LABELLED_NAME.test(slice)) return true;
  for (const match of slice.matchAll(CAPITALISED_PAIR)) {
    const first = match[1] ?? "";
    const second = match[2] ?? "";
    if (!NOT_NAME_WORDS.has(first) && !NOT_NAME_WORDS.has(second)) return true;
  }
  return false;
}

function anyMatchNearName(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (hasNameNear(text, start, start + match[0].length)) return true;
  }
  return false;
}

// ---- rule patterns ------------------------------------------------------------------------------

const SSN_DASHED = /\b\d{3}-\d{2}-\d{4}\b/;
const SSN_KEYWORD = /\b(?:ssn|social security(?: number| no\.?)?)\b[^0-9]{0,20}\d{9}\b/i;

const MRN_WITH_ID = /\b(?:MRN|medical record (?:number|no\.?|#))\s*[:#=]?\s*\d{5,12}\b/gi;

const DOB_WITH_DATE =
  /\b(?:DOB|D\.O\.B\.|date of birth|birth\s?date|born(?: on)?)\s*[:#=]?\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/gi;

const PRIVATE_KEY = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/;
const SECRET_ASSIGNMENT =
  /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']?(?!\[REDACTED)[^\s"',;]{8,}/i;

export const TEXT_RULES: readonly TextRule[] = [
  {
    id: "CRED.AWS_ACCESS_KEY",
    description: "Cloud access key identifier",
    matches: (t) => AWS_ACCESS_KEY.test(t),
  },
  {
    id: "CRED.BEARER_TOKEN",
    description: "Bearer token value",
    matches: (t) => BEARER_TOKEN.test(t),
  },
  {
    id: "CRED.PRIVATE_KEY",
    description: "Private key block header",
    matches: (t) => PRIVATE_KEY.test(t),
  },
  {
    id: "CRED.SECRET_ASSIGNMENT",
    description: "Password, secret or key assigned a value",
    matches: (t) => SECRET_ASSIGNMENT.test(t),
  },
  {
    id: "PHI.DOB_WITH_NAME",
    description: "Date of birth next to a person name",
    matches: (t) => anyMatchNearName(t, DOB_WITH_DATE),
  },
  {
    id: "PHI.MRN_WITH_NAME",
    description: "Medical record number next to a person name",
    matches: (t) => anyMatchNearName(t, MRN_WITH_ID),
  },
  {
    id: "PHI.SSN",
    description: "US social security number",
    matches: (t) => SSN_DASHED.test(t) || SSN_KEYWORD.test(t),
  },
  {
    id: "PHI.TABULAR_ROWS",
    description: "Delimited rows under a header with several patient-style columns",
    matches: (t) => hasPatientTable(t),
  },
];

// ---- tabular patient data -----------------------------------------------------------------------

const PATIENT_COLUMNS = new Set([
  "patient",
  "patient_id",
  "patient_name",
  "name",
  "full_name",
  "first_name",
  "last_name",
  "firstname",
  "lastname",
  "mrn",
  "dob",
  "date_of_birth",
  "birth_date",
  "ssn",
  "address",
  "street",
  "city",
  "zip",
  "zipcode",
  "phone",
  "diagnosis",
  "dx",
  "icd10",
  "icd_code",
  "admission_date",
  "discharge_date",
  "encounter_id",
  "insurance_id",
  "member_id",
  "gender",
  "sex",
  "race",
]);

/** Normalise a column or key name: lower case, non-alphanumerics collapsed to `_`. */
export function normaliseColumnName(name: string): string {
  return name
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function countPatientColumns(names: readonly string[]): number {
  return names.filter((n) => PATIENT_COLUMNS.has(normaliseColumnName(n))).length;
}

const DELIMITERS = [",", "\t", "|", ";"] as const;

function hasPatientTable(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = lines[i] ?? "";
    for (const delimiter of DELIMITERS) {
      const columns = header.split(delimiter);
      if (columns.length < 3 || countPatientColumns(columns) < 3) continue;
      const row = lines[i + 1] ?? "";
      if (row.split(delimiter).length === columns.length) return true;
    }
  }
  return false;
}

/** True when an array holds at least two objects sharing three or more patient-style keys. */
export function isPatientRowArray(rows: readonly unknown[]): boolean {
  let patientRows = 0;
  for (const row of rows) {
    if (row !== null && typeof row === "object" && !Array.isArray(row)) {
      if (countPatientColumns(Object.keys(row)) >= 3) patientRows += 1;
    }
  }
  return patientRows >= 2;
}
