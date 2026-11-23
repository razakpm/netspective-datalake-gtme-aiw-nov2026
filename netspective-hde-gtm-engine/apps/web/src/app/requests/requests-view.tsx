"use client";
import { useCallback, useEffect, useState } from "react";
import { PhiWarning } from "../../components/phi-warning.js";
import { describeCatalogueError, newKey } from "../../lib/catalogue-http.js";
import {
  browserRequestsApi,
  FLAG_TEXT,
  KIND_TEXT,
  type NoticeVersion,
  type RequestDetail,
  type RequestsApi,
  type RequestSummary,
} from "../../lib/requests-api.js";

// Request inbox (feature 006, tasks T067 and T069; spec FR-030, FR-017): register downloads, working session
// requests and intake submissions with their review state and flags, and the versions of the privacy notice
// and consent wording. Controls appear only for holders of the permission; the API enforces every permission
// regardless. Nothing here sends a message. Offer 6 intakes show field names only.

const label = (s: string) => s.replace(/_/g, " ");

function IntakeSummary({ intake }: { intake: Record<string, unknown> }) {
  const show = (v: unknown): string =>
    Array.isArray(v)
      ? v.map(show).join(", ")
      : typeof v === "object" && v !== null
        ? Object.values(v).map(show).join(" · ")
        : String(v);
  return (
    <dl aria-label="Intake answers">
      {Object.entries(intake).map(([k, v]) => (
        <div key={k}>
          <dt>{label(k.replace(/([A-Z])/g, " $1").toLowerCase())}</dt>
          <dd>{show(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RequestsView({
  permissions,
  userId,
  api = browserRequestsApi,
}: {
  permissions: readonly string[];
  userId: string;
  api?: RequestsApi;
}) {
  const can = (p: string) => permissions.includes(p);
  const [items, setItems] = useState<RequestSummary[] | null>(null);
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [notices, setNotices] = useState<NoticeVersion[]>([]);
  const [state, setState] = useState("");
  const [kind, setKind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [accountId, setAccountId] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [noticeText, setNoticeText] = useState("");
  const [consentText, setConsentText] = useState("");

  const run = useCallback(async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(describeCatalogueError(e));
    }
  }, []);
  const loadList = useCallback(
    () =>
      can("requests.read")
        ? run(async () => setItems((await api.list({ state, kind })).items))
        : Promise.resolve(),
    [api, state, kind, run],
  );
  const loadNotices = useCallback(
    () =>
      can("notices.manage") || can("notices.approve")
        ? run(async () => setNotices((await api.notices.list()).items))
        : Promise.resolve(),
    [api, run],
  );
  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    void loadNotices();
  }, [loadNotices]);

  const open = (id: string) => run(async () => setDetail(await api.get(id)));
  const review = (body: Parameters<RequestsApi["review"]>[1]) =>
    run(async () => {
      if (!detail) return;
      setDetail(await api.review(detail.id, body, newKey()));
      setReason("");
      await loadList();
    });
  const settled = detail ? detail.state === "linked" || detail.state === "closed" : false;

  return (
    <main>
      <h1>Requests</h1>
      {error ? <p role="alert">{error}</p> : null}

      {can("requests.read") ? (
        <section aria-label="Request inbox">
          <h2>Inbox</h2>
          <label>
            State
            <select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All</option>
              {["received", "reviewed", "linked", "closed"].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All</option>
              {Object.entries(KIND_TEXT).map(([k, t]) => (
                <option key={k} value={k}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {items === null ? <p>Loading…</p> : null}
          {items?.length === 0 ? <p>No requests match.</p> : null}
          <ul>
            {items?.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => void open(r.id)}>
                  {KIND_TEXT[r.kind]} · {r.orgName ?? "unknown organisation"} ·{" "}
                  {r.email ?? "no email"}
                </button>{" "}
                <span>{label(r.state)}</span>
                {r.flags.map((f) => (
                  <span key={f}> [{FLAG_TEXT[f]}]</span>
                ))}
              </li>
            ))}
          </ul>

          {detail ? (
            <article aria-label="Request detail">
              <h3>
                {KIND_TEXT[detail.kind]} · {label(detail.state)}
              </h3>
              <p>
                {detail.displayName ?? "No name given"} · {detail.roleTitle ?? "no role"} ·{" "}
                {detail.orgName ?? "no organisation"} (
                {detail.orgType ? label(detail.orgType) : "no type"}) · {detail.email ?? "no email"}
              </p>
              <p>
                Consent to be contacted: {detail.consent.consentGiven ? "given" : "not given"}{" "}
                (notice version {detail.consent.noticeVersionId.slice(0, 8)}).
              </p>
              {detail.flags.length > 0 ? (
                <p>Flags: {detail.flags.map((f) => FLAG_TEXT[f]).join(", ")}.</p>
              ) : null}
              {detail.download ? (
                <p>
                  Register {detail.download.delivered ? "delivered by link" : "not delivered"}
                  {detail.download.deliveryFailure
                    ? ` (${label(detail.download.deliveryFailure)})`
                    : ""}
                  . This is first-party engagement, not buying intent.
                </p>
              ) : null}
              {detail.decisions ? (
                <ol aria-label="Open decisions">
                  {detail.decisions.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ol>
              ) : null}
              {detail.intake ? <IntakeSummary intake={detail.intake} /> : null}
              {detail.recommendationId ? (
                <p>A follow-up recommendation is waiting for review on the account workspace.</p>
              ) : null}

              {can("requests.review") && !settled ? (
                <form aria-label="Review this request" onSubmit={(e) => e.preventDefault()}>
                  <button
                    type="button"
                    disabled={detail.state !== "received"}
                    onClick={() => void review({ action: "mark_reviewed" })}
                  >
                    Mark reviewed
                  </button>
                  <label>
                    Account to link to
                    <input
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      placeholder={detail.accountId ?? ""}
                    />
                  </label>
                  {detail.flags.includes("personal_email") ? (
                    <label>
                      Business email
                      <input
                        type="email"
                        value={businessEmail}
                        onChange={(e) => setBusinessEmail(e.target.value)}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      void review({
                        action: "link",
                        ...(accountId || detail.accountId
                          ? { accountId: accountId || (detail.accountId as string) }
                          : {}),
                        ...(businessEmail ? { businessEmail } : {}),
                      })
                    }
                  >
                    Link
                  </button>
                  <label>
                    Reason for closing
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={300}
                    />
                  </label>
                  <PhiWarning value={reason} />
                  <button
                    type="button"
                    disabled={reason.trim().length < 3}
                    onClick={() => void review({ action: "close", reason })}
                  >
                    Close
                  </button>
                </form>
              ) : null}
            </article>
          ) : null}
        </section>
      ) : null}

      {can("notices.manage") || can("notices.approve") ? (
        <section aria-label="Notice versions">
          <h2>Privacy notice and consent wording</h2>
          <p>
            A form shows a version only after someone other than its author approves it. Until one
            is approved the forms say they are not available.
          </p>
          <ul>
            {notices.map((n) => (
              <li key={n.id}>
                Version {n.version}: {n.approvedBy ? "approved" : "not approved"} — {n.consentText}
                {can("notices.approve") && !n.approvedBy && n.createdBy !== userId ? (
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await api.notices.approve(n.id, newKey());
                        await loadNotices();
                      })
                    }
                  >
                    Approve version {n.version}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {can("notices.manage") ? (
            <form
              aria-label="Draft a notice version"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.notices.create({ noticeText, consentText }, newKey());
                  setNoticeText("");
                  setConsentText("");
                  await loadNotices();
                });
              }}
            >
              <label>
                Privacy notice text
                <textarea
                  value={noticeText}
                  onChange={(e) => setNoticeText(e.target.value)}
                  minLength={20}
                  maxLength={4000}
                  required
                />
              </label>
              <label>
                Consent wording
                <textarea
                  value={consentText}
                  onChange={(e) => setConsentText(e.target.value)}
                  minLength={10}
                  maxLength={600}
                  required
                />
              </label>
              <PhiWarning value={`${noticeText} ${consentText}`} />
              <button type="submit">Save draft</button>
            </form>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
