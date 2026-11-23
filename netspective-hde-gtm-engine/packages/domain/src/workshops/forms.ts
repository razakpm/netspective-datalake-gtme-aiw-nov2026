import { PROGRAM_TYPES } from "./intake.js";

// What each public form asks for, beyond the contact details every form takes (feature 006, spec FR-025,
// FR-026). The hosted pages and any site that embeds a form draw the questions from here, and a test checks
// that every key is a key of the typed schema and that none asks for a price, a budget or a credential.

export type FormFieldType = "text" | "longtext" | "select" | "list" | "names";

export interface FormField {
  /** A key of the typed schema; a dot goes one level into an object (recentOnboarding.senderLabel). */
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  maxLength?: number;
  maxItems?: number;
  minItems?: number;
  options?: { key: string; label: string }[];
  help?: string;
}

const yesNo = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
  { key: "unsure", label: "Not sure" },
];

export const SESSION_FORM_FIELDS: FormField[] = [
  {
    key: "decisions",
    label: "Open decisions you would like to bring (up to five)",
    type: "list",
    required: true,
    minItems: 1,
    maxItems: 5,
    maxLength: 300,
    help: "Describe a decision, not a record. Do not include patient information.",
  },
];

export const OFFER1_FORM_FIELDS: FormField[] = [
  {
    key: "programType",
    label: "Organisation or program type",
    type: "select",
    required: true,
    options: PROGRAM_TYPES.map((key) => ({ key, label: key.replaceAll("_", " ") })),
  },
  {
    key: "organisationName",
    label: "Organisation name",
    type: "text",
    required: true,
    maxLength: 200,
  },
  {
    key: "recentOnboarding.senderLabel",
    label: "One recent sender onboarding (describe the sender, not a person)",
    type: "text",
    required: true,
    maxLength: 120,
  },
  {
    key: "recentOnboarding.formatAndGuide",
    label: "Format and implementation guide in use",
    type: "longtext",
    required: true,
    maxLength: 500,
  },
  {
    key: "recentOnboarding.timelineAndStages",
    label: "Timeline and stages",
    type: "longtext",
    required: true,
    maxLength: 500,
  },
  {
    key: "knownDelays",
    label: "Known delays or rejections",
    type: "list",
    required: false,
    maxItems: 10,
    maxLength: 500,
  },
  {
    key: "attendingRoles",
    label: "Roles who will attend",
    type: "list",
    required: true,
    minItems: 1,
    maxItems: 10,
    maxLength: 120,
  },
  {
    key: "specsAvailable",
    label: "Are non-PHI specifications available to share?",
    type: "select",
    required: true,
    options: yesNo,
  },
  {
    key: "scrubbedRejectionLogsAvailable",
    label: "Are scrubbed rejection logs available to share?",
    type: "select",
    required: true,
    options: yesNo,
  },
];

export const OFFER6_FORM_FIELDS: FormField[] = [
  { key: "useCase", label: "The named use case", type: "text", required: true, maxLength: 200 },
  {
    key: "pilotOwner",
    label: "Pilot owner (a role or a name)",
    type: "text",
    required: true,
    maxLength: 120,
  },
  {
    key: "sourceSystems",
    label: "Source system names",
    type: "list",
    required: true,
    minItems: 1,
    maxItems: 10,
    maxLength: 120,
  },
  {
    key: "fieldNames",
    label: "Ten field names (names only, never values)",
    type: "names",
    required: true,
    minItems: 10,
    maxItems: 10,
    maxLength: 60,
    help: "For example DOB or patient_id. Do not enter real values or patient information.",
  },
  {
    key: "dataLead",
    label: "Data or integration lead",
    type: "text",
    required: true,
    maxLength: 120,
  },
  {
    key: "fieldQualityConcerns",
    label: "Known field quality concerns",
    type: "list",
    required: false,
    maxItems: 10,
    maxLength: 500,
  },
  {
    key: "interfaceTypes",
    label: "Interface or message types",
    type: "list",
    required: false,
    maxItems: 10,
    maxLength: 120,
  },
  {
    key: "attendees",
    label: "Who will attend",
    type: "list",
    required: true,
    minItems: 1,
    maxItems: 10,
    maxLength: 120,
  },
];
