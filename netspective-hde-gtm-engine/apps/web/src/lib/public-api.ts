// Browser-side client for the public forms (contracts/public.openapi.yaml). No session and no cookie: it
// calls the same-origin public proxy. A refusal shows a plain message, never the server's own text, except
// for the plain messages we wrote for intake and decision checks.

export interface FormField {
  key: string;
  label: string;
  type: "text" | "longtext" | "select" | "list" | "names";
  required: boolean;
  maxLength?: number;
  maxItems?: number;
  minItems?: number;
  help?: string;
  options?: { key: string; label: string }[];
}
export type PublicKind = "download" | "working_session" | "intake";
export interface FormDefinition {
  slug: string;
  title: string;
  kinds: PublicKind[];
  fields: Partial<Record<PublicKind, FormField[]>>;
  orgTypes: { key: string; label: string }[];
  notice: { versionId: string; noticeText: string; consentText: string };
  formToken: string;
  issuedAt: string;
}
export interface Receipt {
  requestId: string;
  status: "received";
  flags: "personal_email"[];
  download?: { url: string | null; expiresAt: string | null; delivered: boolean };
}
export interface PublicSubmission {
  kind: PublicKind;
  formToken: string;
  noticeVersionId: string;
  consentToContact: boolean;
  website: string;
  contact: { email: string; displayName?: string; role: string; orgName: string; orgType: string };
  decisions?: string[];
  intake?: unknown;
}

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    readonly codes: string[],
    readonly detail: string | null,
  ) {
    super(`request failed (${status})`);
    this.name = "PublicApiError";
  }
}

const MESSAGES: Record<string, string> = {
  form_rejected: "The form could not be accepted. Please reload the page and try again.",
  notice_changed: "The privacy notice was updated. Please reload the page and read it again.",
  no_notice: "This form is not available yet. Please try again later.",
  rate_limited: "Too many requests. Please wait a minute and try again.",
  origin_not_allowed: "This site is not allowed to use this form.",
  kind_not_available: "This form does not take that kind of request.",
};

/** A message safe to show a visitor. */
export function describePublicError(error: unknown): string {
  if (error instanceof PublicApiError) {
    const known = error.codes.map((c) => MESSAGES[c]).find(Boolean);
    if (known) return known;
    if (
      (error.codes.includes("intake_invalid") || error.codes.includes("decisions_invalid")) &&
      error.detail
    ) {
      return error.detail;
    }
    if (error.status === 422) {
      return "This looks like it may contain patient or personal health information. Please remove it and try again.";
    }
    if (error.status === 400) return "Please check the details and try again.";
    if (error.status === 413) return "That was too long. Please shorten it and try again.";
    if (error.status === 429) return MESSAGES["rate_limited"] as string;
    if (error.status === 503) return MESSAGES["no_notice"] as string;
  }
  return "Something went wrong. Please try again.";
}

export interface PublicApi {
  submit(slug: string, body: PublicSubmission): Promise<Receipt>;
}

export const browserPublicApi: PublicApi = {
  async submit(slug, body) {
    const response = await fetch(`/api/public/offers/${encodeURIComponent(slug)}/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as {
        codes?: unknown;
        detail?: unknown;
      };
      throw new PublicApiError(
        response.status,
        Array.isArray(problem.codes)
          ? problem.codes.filter((c): c is string => typeof c === "string")
          : [],
        typeof problem.detail === "string" ? problem.detail : null,
      );
    }
    return (await response.json()) as Receipt;
  },
};

/** The API returns a path under /api/v1/public; the hosted pages reach it through the public proxy. */
export const publicDownloadHref = (apiUrl: string): string =>
  apiUrl.replace(/^\/api\/v1\/public\//, "/api/public/");
