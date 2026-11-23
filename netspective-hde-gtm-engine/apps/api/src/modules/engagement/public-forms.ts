import {
  OFFER1_FORM_FIELDS,
  OFFER6_FORM_FIELDS,
  ORG_TYPES,
  SESSION_FORM_FIELDS,
  type FormField,
} from "@gtm/domain";

// The public forms (feature 006, research R-08). Slugs are the offer keys feature 005 seeded. A form may
// offer one or two kinds of request. Nothing on any form asks for a price, a budget, a credential or
// production data.

export const FORM_SLUGS = [
  "ccda-to-fhir-mapping-decision-register",
  "sender-onboarding-friction-map",
  "pilot-input-trace-workshop",
] as const;
export type FormSlug = (typeof FORM_SLUGS)[number];
export type RequestKind = "download" | "working_session" | "intake";

export interface FormSpec {
  slug: FormSlug;
  title: string;
  kinds: RequestKind[];
  /** The questions beyond the contact details, per kind. A download asks for nothing more. */
  fields: Partial<Record<RequestKind, FormField[]>>;
}

export const FORMS: Readonly<Record<FormSlug, FormSpec>> = {
  "ccda-to-fhir-mapping-decision-register": {
    slug: "ccda-to-fhir-mapping-decision-register",
    title: "CCDA-to-FHIR Mapping Decision Register",
    kinds: ["download", "working_session"],
    fields: { working_session: SESSION_FORM_FIELDS },
  },
  "sender-onboarding-friction-map": {
    slug: "sender-onboarding-friction-map",
    title: "Sender Onboarding Friction Map: before the session",
    kinds: ["intake"],
    fields: { intake: OFFER1_FORM_FIELDS },
  },
  "pilot-input-trace-workshop": {
    slug: "pilot-input-trace-workshop",
    title: "Pilot Input Trace Workshop: before the session",
    kinds: ["intake"],
    fields: { intake: OFFER6_FORM_FIELDS },
  },
};

export const isFormSlug = (s: string): s is FormSlug =>
  (FORM_SLUGS as readonly string[]).includes(s);

/** The fixed organisation type list shown on every form (feature 002's list, without "unknown"). */
export const FORM_ORG_TYPES = ORG_TYPES.filter((t) => t !== "unknown").map((key) => ({
  key,
  label: key
    .split("_")
    .map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" "),
}));
