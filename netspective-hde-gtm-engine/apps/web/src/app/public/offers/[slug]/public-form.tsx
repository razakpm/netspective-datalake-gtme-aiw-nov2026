"use client";
import { useState, type FormEvent } from "react";
import { PhiWarning } from "../../../../components/phi-warning.js";
import {
  browserPublicApi,
  describePublicError,
  publicDownloadHref,
  type FormDefinition,
  type FormField,
  type PublicApi,
  type PublicKind,
  type Receipt,
} from "../../../../lib/public-api.js";

// The hosted public form (feature 006, task T068; spec FR-016, FR-024 to FR-026). One page per offer: the
// register download and the working session request, or an intake. No session is needed. The consent box
// starts unticked and is never a condition of receiving the register. There is no question about price,
// budget, credentials or production data, and the intake takes field names and never values.

const KIND_TEXT: Record<PublicKind, string> = {
  download: "Download the register",
  working_session: "Request a 30-minute working session",
  intake: "Send the intake",
};

const lines = (value: string): string[] =>
  value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Build the nested answer object from dotted keys (recentOnboarding.senderLabel). */
function setPath(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    node[part] = (node[part] as Record<string, unknown> | undefined) ?? {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1] as string] = value;
}

function answersOf(fields: FormField[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.key] ?? "";
    if (f.type === "list" || f.type === "names") {
      if (lines(raw).length > 0 || f.required) setPath(out, f.key, lines(raw));
    } else if (raw !== "" || f.required) setPath(out, f.key, raw);
  }
  return out;
}

export function PublicForm({
  form,
  api = browserPublicApi,
}: {
  form: FormDefinition;
  api?: PublicApi;
}) {
  const [kind, setKind] = useState<PublicKind>(form.kinds[0] as PublicKind);
  const [contact, setContact] = useState({
    email: "",
    displayName: "",
    role: "",
    orgName: "",
    orgType: "",
  });
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const fields = form.fields[kind] ?? [];
  const allText = [contact.role, contact.orgName, ...Object.values(values)].join(" ");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const answers = answersOf(fields, values);
      setReceipt(
        await api.submit(form.slug, {
          kind,
          formToken: form.formToken,
          noticeVersionId: form.notice.versionId,
          consentToContact: consent,
          website,
          contact: {
            email: contact.email,
            ...(contact.displayName ? { displayName: contact.displayName } : {}),
            role: contact.role,
            orgName: contact.orgName,
            orgType: contact.orgType,
          },
          ...(kind === "working_session"
            ? { decisions: (answers["decisions"] as string[] | undefined) ?? [] }
            : {}),
          ...(kind === "intake" ? { intake: answers } : {}),
        }),
      );
    } catch (e) {
      setError(describePublicError(e));
    } finally {
      setBusy(false);
    }
  }

  if (receipt) {
    return (
      <main>
        <h1>{form.title}</h1>
        <p role="status">Thank you. We have received your request.</p>
        {receipt.flags.includes("personal_email") ? (
          <p>
            You used a personal email address. A person will look at it before we connect it to an
            organisation.
          </p>
        ) : null}
        {receipt.download ? (
          receipt.download.delivered && receipt.download.url ? (
            <p>
              <a href={publicDownloadHref(receipt.download.url)}>Download the register</a>
              {receipt.download.expiresAt
                ? ` (this link works until ${new Date(receipt.download.expiresAt).toUTCString()}; you can ask for a new one here)`
                : ""}
              .
            </p>
          ) : (
            <p role="alert">
              We could not prepare the register just now. We have recorded your request. Please try
              again later.
            </p>
          )
        ) : (
          <p>
            Nothing has been sent to you. A person will be in touch only if you agreed to be
            contacted.
          </p>
        )}
      </main>
    );
  }

  return (
    <main>
      <h1>{form.title}</h1>
      {form.kinds.length > 1 ? (
        <fieldset>
          <legend>What would you like to do?</legend>
          {form.kinds.map((k) => (
            <label key={k}>
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />{" "}
              {KIND_TEXT[k]}
            </label>
          ))}
        </fieldset>
      ) : null}
      <form aria-label={KIND_TEXT[kind]} onSubmit={(e) => void submit(e)}>
        {error ? <p role="alert">{error}</p> : null}
        <label>
          Work email
          <input
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            value={contact.email}
            onChange={(e) => setContact({ ...contact, email: e.target.value })}
          />
        </label>
        <label>
          Name (optional)
          <input
            maxLength={120}
            autoComplete="name"
            value={contact.displayName}
            onChange={(e) => setContact({ ...contact, displayName: e.target.value })}
          />
        </label>
        <label>
          Your role
          <input
            required
            minLength={2}
            maxLength={120}
            value={contact.role}
            onChange={(e) => setContact({ ...contact, role: e.target.value })}
          />
        </label>
        <label>
          Organisation
          <input
            required
            minLength={2}
            maxLength={200}
            autoComplete="organization"
            value={contact.orgName}
            onChange={(e) => setContact({ ...contact, orgName: e.target.value })}
          />
        </label>
        <label>
          Organisation type
          <select
            required
            value={contact.orgType}
            onChange={(e) => setContact({ ...contact, orgType: e.target.value })}
          >
            <option value="">Choose one</option>
            {form.orgTypes.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        {fields.map((f) => (
          <label key={f.key}>
            {f.label}
            {f.type === "select" ? (
              <select
                required={f.required}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              >
                <option value="">Choose one</option>
                {f.options?.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "text" ? (
              <input
                required={f.required}
                maxLength={f.maxLength}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            ) : (
              <textarea
                required={f.required}
                rows={f.type === "names" ? 10 : 4}
                value={values[f.key] ?? ""}
                aria-describedby={f.help ? `help-${f.key}` : undefined}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
            {f.type === "list" || f.type === "names" ? <small> One per line.</small> : null}
            {f.help ? <small id={`help-${f.key}`}> {f.help}</small> : null}
          </label>
        ))}
        <PhiWarning value={allText} />

        <div
          className="honeypot"
          aria-hidden="true"
          style={{ position: "absolute", left: "-10000px" }}
        >
          <label>
            Leave this field empty
            <input
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </label>
        </div>

        <section aria-label="Privacy notice">
          <h2>Privacy notice</h2>
          <p>{form.notice.noticeText}</p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            {form.notice.consentText} (Optional.{" "}
            {kind === "download"
              ? "You receive the register either way."
              : "You can still send this request without ticking."}
            )
          </label>
        </section>
        <button type="submit" disabled={busy}>
          {KIND_TEXT[kind]}
        </button>
      </form>
    </main>
  );
}
