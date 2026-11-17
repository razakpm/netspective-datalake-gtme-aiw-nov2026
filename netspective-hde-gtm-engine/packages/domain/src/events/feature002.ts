import { z } from "zod";

// Feature 002 event payloads (data-model.md "Events"). Identifiers only: no contact names or emails
// (spec FR-048). Strict schemas so an extra personal field cannot slip in.

export const AccountCreatedPayload = z
  .object({
    account_id: z.string().min(1),
    org_type: z.string().min(1),
    source: z.enum(["import", "manual"]),
  })
  .strict();

export const ContactIdentifiedPayload = z
  .object({
    contact_id: z.string().min(1),
    account_id: z.string().min(1),
    source: z.string().min(1),
  })
  .strict();

export const IcpFitAssessedPayload = z
  .object({
    assessment_id: z.string().min(1),
    account_id: z.string().min(1),
    icp: z.enum(["icp1", "icp2"]),
    status: z.enum(["strong", "possible", "weak", "excluded", "unknown"]),
    definition_version: z.number().int().positive(),
  })
  .strict();

export const FEATURE002_EVENT_PAYLOADS = {
  "account.created": AccountCreatedPayload,
  "contact.identified": ContactIdentifiedPayload,
  "icp.fit_assessed": IcpFitAssessedPayload,
} as const;

export type AccountCreated = z.infer<typeof AccountCreatedPayload>;
export const toAccountCreatedPayload = (p: AccountCreated): AccountCreated =>
  AccountCreatedPayload.parse(p);
export type ContactIdentified = z.infer<typeof ContactIdentifiedPayload>;
export const toContactIdentifiedPayload = (p: ContactIdentified): ContactIdentified =>
  ContactIdentifiedPayload.parse(p);
export type IcpFitAssessed = z.infer<typeof IcpFitAssessedPayload>;
export const toIcpFitAssessedPayload = (p: IcpFitAssessed): IcpFitAssessed =>
  IcpFitAssessedPayload.parse(p);
