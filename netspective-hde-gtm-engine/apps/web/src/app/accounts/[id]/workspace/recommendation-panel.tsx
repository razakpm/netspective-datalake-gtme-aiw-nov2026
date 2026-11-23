"use client";
import { useCallback, useEffect, useState } from "react";
import { PhiWarning } from "../../../../components/phi-warning.js";
import { describeCatalogueError } from "../../../../lib/catalogue-http.js";
import {
  blockedText,
  browserRecommendationsApi,
  exclusionText,
  newKey,
  offerLabel,
  outcomeText,
  type Recommendation,
  type RecommendationsApi,
} from "../../../../lib/recommendations-api.js";

// Recommendation panel on the account workspace (feature 006, task T066; spec FR-001, FR-007, FR-014,
// FR-030). It shows the latest recommendation with its reasons, limitations and rule set version, whether it
// is out of date, and what a full offer leaves open. Controls appear only for holders of the permission; the
// API enforces every permission regardless. Accepting a recommendation sends nothing.

export function RecommendationPanel({
  accountId,
  contactId,
  permissions,
  api = browserRecommendationsApi,
}: {
  accountId: string;
  contactId?: string;
  permissions: readonly string[];
  api?: RecommendationsApi;
}) {
  const can = (p: string) => permissions.includes(p);
  const [items, setItems] = useState<Recommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [waitReason, setWaitReason] = useState("");

  const load = useCallback(() => {
    api
      .list(accountId)
      .then((r) => setItems(r.items))
      .catch((e) => setError(describeCatalogueError(e)));
  }, [api, accountId]);
  useEffect(load, [load]);

  const run = async (work: () => Promise<void>) => {
    setError(null);
    setMessage(null);
    try {
      await work();
      load();
    } catch (e) {
      setError(describeCatalogueError(e));
    }
  };

  const latest = items?.[0] ?? null;
  const earlier = items?.slice(1) ?? [];
  return (
    <section aria-label="Offer recommendation">
      <h2>Offer recommendation</h2>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {items === null ? <p>Loading…</p> : null}
      {items !== null && latest === null ? (
        <p>No recommendation has been made for this account yet.</p>
      ) : null}

      {latest ? (
        <article aria-label="Latest recommendation">
          <h3>{outcomeText(latest)}</h3>
          <p>
            Rule set version {latest.ruleSetVersion}.{" "}
            {latest.reviewState === "pending"
              ? "Waiting for review."
              : `Review: ${latest.reviewState}.`}
          </p>
          {latest.outOfDate ? (
            <p role="note">
              Out of date: the facts behind this recommendation have changed. Ask for a new one.
            </p>
          ) : null}
          <p>
            {latest.outreach === "allowed"
              ? "Outreach is allowed. Nothing is sent from here."
              : `Outreach is blocked: ${blockedText(latest.blockedReasons)}.`}
          </p>
          <p>{latest.explanation}</p>
          {latest.aiUsed ? (
            <p role="note">
              The explanation and order were drafted by a language model from the eligible offers
              only.
            </p>
          ) : null}
          {latest.limitations.length > 0 ? (
            <>
              <h4>What this could not take into account</h4>
              <ul>
                {latest.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          ) : null}
          {latest.excluded.length > 0 ? (
            <>
              <h4>Left out</h4>
              <ul>
                {latest.excluded.map((e) => (
                  <li key={`${e.offerKey}-${e.code}`}>{exclusionText(e)}</li>
                ))}
              </ul>
            </>
          ) : null}
          {latest.matched.length > 0 ? (
            <p>Rules that matched: {latest.matched.map((m) => m.ruleId).join(", ")}.</p>
          ) : null}

          {latest.alternatives.length > 0 ? (
            <>
              <h4>Alternatives</h4>
              <ul>
                {latest.alternatives.map((a) => (
                  <li key={`${a.kind}-${a.offerKey ?? ""}`}>
                    {a.reason}
                    {a.kind === "wait_list" && a.offerId && can("waitlist.edit") ? (
                      <form
                        aria-label="Add to the wait-list"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(async () => {
                            await api.addToWaitlist(
                              a.offerId as string,
                              {
                                accountId,
                                ...(contactId ? { contactId } : {}),
                                reason: waitReason,
                              },
                              newKey(),
                            );
                            setWaitReason("");
                            setMessage(
                              `Added to the wait-list for ${offerLabel(a.offerKey)}. Nothing is sent.`,
                            );
                          });
                        }}
                      >
                        <label>
                          Why wait-list this account
                          <input
                            value={waitReason}
                            onChange={(e) => setWaitReason(e.target.value)}
                            minLength={3}
                            maxLength={300}
                            required
                          />
                        </label>
                        <PhiWarning value={waitReason} />
                        <button type="submit">Add to the wait-list</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {latest.reviewState === "pending" && can("offers.recommend") ? (
            <form aria-label="Review the recommendation" onSubmit={(e) => e.preventDefault()}>
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    await api.review(latest.id, { decision: "accept" }, newKey());
                    setMessage("Accepted. Nothing was sent.");
                  })
                }
              >
                Accept
              </button>
              <label>
                Reason for dismissing
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </label>
              <button
                type="button"
                disabled={reason.trim().length < 3}
                onClick={() =>
                  void run(async () => {
                    await api.review(latest.id, { decision: "dismiss", reason }, newKey());
                    setReason("");
                    setMessage("Dismissed.");
                  })
                }
              >
                Dismiss
              </button>
            </form>
          ) : null}
        </article>
      ) : null}

      {can("offers.recommend") ? (
        <button
          type="button"
          onClick={() =>
            void run(async () => {
              await api.create(accountId, contactId, newKey());
            })
          }
        >
          {latest ? "Recommend again" : "Get a recommendation"}
        </button>
      ) : null}

      {earlier.length > 0 ? (
        <>
          <h3>Earlier recommendations</h3>
          <ul>
            {earlier.map((r) => (
              <li key={r.id}>
                {outcomeText(r)} · version {r.ruleSetVersion} · {r.reviewState}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
