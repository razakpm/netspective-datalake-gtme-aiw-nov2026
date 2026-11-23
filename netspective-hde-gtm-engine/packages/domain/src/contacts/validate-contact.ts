import { canonicalEmail } from "./suppression.js";

// Contact validation for a first-party form (feature 002 US2 slice, built in feature 006). Pure. A contact
// is a business contact: a personal (free consumer) address is not one.

export type ContactCheck =
  | { ok: true; email: string; domain: string; role: string | null }
  | { ok: false; code: "email_invalid" | "personal_email" | "role_too_long" };

const LOCAL = /^[a-z0-9._%+'-]{1,64}$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export const ROLE_MAX = 120;

export function validateContact(
  input: { email: string; role: string },
  personalDomains: ReadonlySet<string>,
): ContactCheck {
  const email = canonicalEmail(input.email);
  const parts = email.split("@");
  if (parts.length !== 2) return { ok: false, code: "email_invalid" };
  const [local = "", domain = ""] = parts;
  const labels = domain.split(".");
  if (
    !LOCAL.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    labels.length < 2 ||
    !labels.every((l) => LABEL.test(l)) ||
    email.length > 254
  ) {
    return { ok: false, code: "email_invalid" };
  }
  if (personalDomains.has(domain)) return { ok: false, code: "personal_email" };
  const role = input.role.trim();
  if (role.length > ROLE_MAX) return { ok: false, code: "role_too_long" };
  return { ok: true, email, domain, role: role === "" ? null : role };
}
