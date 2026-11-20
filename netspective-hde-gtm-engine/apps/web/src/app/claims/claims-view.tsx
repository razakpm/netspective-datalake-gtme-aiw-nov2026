"use client";
import { useCallback, useEffect, useState } from "react";
import { PhiWarning } from "../../components/phi-warning.js";
import { describeCatalogueError, newKey } from "../../lib/catalogue-http.js";
import {
  browserClaimsApi,
  type ClaimDetail,
  type ClaimStatus,
  type ClaimSummary,
  type ClaimsApi,
  type LintMatch,
} from "../../lib/claims-api.js";

// Claim review queue (feature 005, task T074): claims by status with evidence, checker results and approve
// or reject controls for designated approvers. A claim whose evidence lapsed reads "needs review". The
// default for an unapproved statement is omission. The API enforces every permission regardless.

const label = (s: string) => s.replace(/_/g, " ");
const STATUSES: ClaimStatus[] = [
  "draft",
  "in_review",
  "approved",
  "needs_review",
  "rejected",
  "withdrawn",
];

/** The sentence around a match, for a false-positive record (the API re-checks it flags that rule). */
export function sentenceAround(text: string, m: LintMatch): string {
  const before = Math.max(
    text.lastIndexOf(". ", m.start),
    text.lastIndexOf("! ", m.start),
    text.lastIndexOf("? ", m.start),
  );
  const rest = text.slice(m.end);
  const next = rest.search(/[.!?](\s|$)/);
  const from = before < 0 ? 0 : before + 2;
  const to = next < 0 ? text.length : m.end + next + 1;
  return text.slice(from, to).trim();
}

export function ClaimsView({
  permissions,
  userId,
  api = browserClaimsApi,
}: {
  permissions: readonly string[];
  userId: string;
  api?: ClaimsApi;
}) {
  const can = (p: string) => permissions.includes(p);
  const [status, setStatus] = useState<ClaimStatus | "">("");
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [detail, setDetail] = useState<ClaimDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  const run = useCallback(async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(describeCatalogueError(e));
    }
  }, []);
  const load = useCallback(
    () => run(async () => setClaims((await api.list(status || undefined)).items)),
    [api, run, status],
  );
  const open = useCallback(
    (id: string) => run(async () => setDetail(await api.get(id))),
    [api, run],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const review = (decision: "approve" | "reject") => {
    if (!detail) return;
    if (note.trim().length < 3) {
      setError("Enter a note of at least 3 characters.");
      return;
    }
    void run(async () => {
      setDetail(await api.review(detail.id, decision, note.trim(), newKey()));
      setNote("");
      await load();
    });
  };
  const falsePositive = (m: LintMatch) => {
    if (!detail) return;
    if (reason.trim().length < 3) {
      setError("Enter a reason of at least 3 characters.");
      return;
    }
    void run(async () => {
      await api.markFalsePositive(
        { sentence: sentenceAround(detail.text, m), ruleId: m.ruleId, reason: reason.trim() },
        newKey(),
      );
      setReason("");
      await open(detail.id);
    });
  };

  const own = detail !== null && detail.draftedBy === userId;
  const reviewable =
    detail !== null && (detail.status === "draft" || detail.status === "in_review");

  return (
    <main>
      <h1>Claim review queue</h1>
      {error ? <p role="alert">{error}</p> : null}
      <label>
        Show claims
        <select value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus | "")}>
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </label>
      <ul aria-label="Claims">
        {claims.map((c) => (
          <li key={c.id}>
            <span>{c.text}</span>
            <span> Status: {c.status === "needs_review" ? "Needs review" : label(c.status)}. </span>
            <span>
              {c.restricted ? "Restricted" : "General"} claim, {c.approvalsHave} of{" "}
              {c.approvalsNeeded} approvals.
            </span>
            <button type="button" onClick={() => void open(c.id)}>
              Open claim
            </button>
          </li>
        ))}
      </ul>

      {detail ? (
        <section aria-label="Claim">
          <h2>Claim</h2>
          <p>{detail.text}</p>
          {detail.status === "needs_review" ? (
            <p role="note">
              Needs review: the evidence has been withdrawn or has expired. It can no longer cover
              text.
            </p>
          ) : null}
          {detail.suggestion ? <p role="note">{detail.suggestion}</p> : null}

          <h3>Evidence</h3>
          {detail.evidence.length === 0 ? <p>No evidence linked.</p> : null}
          <ul aria-label="Evidence">
            {detail.evidence.map((e) => (
              <li key={e.id}>
                {label(e.kind)}: {e.reference} (owner {e.owner}). Expires {e.expiresAt.slice(0, 10)}
                . {e.valid ? "Valid." : "No longer valid."}
              </li>
            ))}
          </ul>

          <h3>Checker results</h3>
          {detail.lint.matches.length === 0 ? <p>No restricted phrases found.</p> : null}
          <ul aria-label="Checker results">
            {detail.lint.matches.map((m) => (
              <li key={`${m.ruleId}-${m.start}`}>
                {label(m.class)}: “{m.text}” ({m.ruleId}). {m.covered ? "Covered." : "Not covered."}
                {can("claims.approve") && !m.covered ? (
                  <button type="button" onClick={() => falsePositive(m)}>
                    Mark as false positive
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {can("claims.approve") && detail.lint.matches.some((m) => !m.covered) ? (
            <div>
              <label>
                Reason for a false positive
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
              </label>
              <PhiWarning value={reason} />
            </div>
          ) : null}

          <h3>Reviews</h3>
          <ul aria-label="Reviews">
            {detail.reviews.map((r) => (
              <li key={`${r.reviewerId}-${r.decision}`}>
                {r.decision === "approve" ? "Approved" : "Rejected"} by {r.reviewerId}: {r.note}
              </li>
            ))}
          </ul>

          {can("claims.approve") && reviewable ? (
            own ? (
              <p role="note">You drafted this claim, so you cannot review it.</p>
            ) : (
              <div>
                <label>
                  Review note
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                </label>
                <PhiWarning value={note} />
                <button type="button" onClick={() => review("approve")}>
                  Approve
                </button>
                <button type="button" onClick={() => review("reject")}>
                  Reject
                </button>
              </div>
            )
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
