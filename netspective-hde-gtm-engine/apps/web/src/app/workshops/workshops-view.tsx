"use client";
import { useEffect, useState } from "react";
import { describeCatalogueError } from "../../lib/catalogue-http.js";
import {
  browserWorkshopsApi,
  OFFER_TEXT,
  STATE_TEXT,
  type OfferEffortSummary,
  type WorkshopsApi,
  type WorkshopSummary,
} from "../../lib/workshops-api.js";

// The workshop list (feature 007, spec FR-037). A workshop is made from a linked request on the request
// inbox. Nothing here sends a message.

/** Delivery effort per offer beside its estimate, which is a hypothesis (spec FR-033). */
function EffortSummary({ api }: { api: WorkshopsApi }) {
  const [rows, setRows] = useState<OfferEffortSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    api
      .effortSummary()
      .then((result) => current && setRows(result.items))
      .catch((e: unknown) => current && setError(describeCatalogueError(e)));
    return () => {
      current = false;
    };
  }, [api]);
  const figure = (value: number | null) => (value === null ? "not recorded" : value);

  return (
    <section aria-label="Delivery effort by offer">
      <h2>Delivery effort by offer</h2>
      {error ? <p role="alert">{error}</p> : null}
      {rows.map((r) => (
        <article key={r.offerId} aria-label={OFFER_TEXT[r.offerKey] ?? r.offerKey}>
          <h3>{OFFER_TEXT[r.offerKey] ?? r.offerKey}</h3>
          <p>
            {r.withEffort} of {r.workshops} workshop(s) with effort recorded; {r.missing} missing.
          </p>
          <p>
            Totals: {r.totalPrepHours} preparation hours, {r.totalSessionHours} session hours.
            Averages: preparation {figure(r.averagePrepHours)}, session{" "}
            {figure(r.averageSessionHours)}, people {figure(r.averagePeople)}.
          </p>
          <p>Estimate (a hypothesis): {r.estimate ?? "none recorded"}</p>
        </article>
      ))}
    </section>
  );
}

export function WorkshopsView({ api = browserWorkshopsApi }: { api?: WorkshopsApi }) {
  const [items, setItems] = useState<WorkshopSummary[] | null>(null);
  const [state, setState] = useState("");
  const [offerId, setOfferId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .list({ state, offerId })
      .then((result) => {
        if (!current) return;
        setItems(result.items);
        setError(null);
      })
      .catch((e: unknown) => current && setError(describeCatalogueError(e)));
    return () => {
      current = false;
    };
  }, [api, state, offerId]);

  return (
    <main>
      <h1>Workshops</h1>
      {error ? <p role="alert">{error}</p> : null}
      <label>
        State
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">All</option>
          {Object.entries(STATE_TEXT).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <label>
        Offer
        <select value={offerId} onChange={(e) => setOfferId(e.target.value)}>
          <option value="">All</option>
          <option value="offer-1">Offer 1</option>
          <option value="offer-6">Offer 6</option>
        </select>
      </label>
      {items === null && !error ? <p>Loading…</p> : null}
      {items?.length === 0 ? <p>No workshops match.</p> : null}
      <ul>
        {items?.map((w) => (
          <li key={w.id}>
            <a href={`/workshops/${encodeURIComponent(w.id)}`}>
              {w.accountName} · {OFFER_TEXT[w.offerKey] ?? w.offerKey}
            </a>{" "}
            <span>{STATE_TEXT[w.state]}</span>
            {w.scheduledAt ? <span> · {new Date(w.scheduledAt).toLocaleString()}</span> : null}
          </li>
        ))}
      </ul>
      <EffortSummary api={api} />
    </main>
  );
}
