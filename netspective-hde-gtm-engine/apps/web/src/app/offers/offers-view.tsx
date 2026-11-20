"use client";
import { useCallback, useEffect, useState } from "react";
import { PhiWarning } from "../../components/phi-warning.js";
import { describeCatalogueError, newKey } from "../../lib/catalogue-http.js";
import {
  browserOffersApi,
  NEXT_STATUSES,
  type Booking,
  type CapacityStatus,
  type OfferDetail,
  type OfferStatus,
  type OfferSummary,
  type OfferVersion,
  type OffersApi,
  type Scores,
} from "../../lib/offers-api.js";

// Offer Workspace v1 (feature 005, task T072): the ten offers with status, capacity and notices; one click
// opens an offer with its versions, limitations, scores, capacity and bookings. Controls appear only for
// holders of the permission; the API enforces every permission regardless.

const label = (s: string) => s.replace(/_/g, " ");

export function capacityText(c: CapacityStatus): string {
  if (c.state === "no_limit_set") return "No limit set (this does not mean unlimited)";
  if (c.state === "exhausted") return `Full: ${c.used} of ${c.limit} sessions this ${c.periodKind}`;
  return `${c.used} of ${c.limit} sessions used this ${c.periodKind}`;
}

function Notices({ offer }: { offer: OfferSummary }) {
  return (
    <>
      {offer.baselineIncomplete ? (
        <p role="note">
          Baseline: attributes incomplete. Approved once from repository facts; other details are
          still to be provided.
        </p>
      ) : null}
      {offer.acknowledgementStale ? (
        <p role="note">
          A limitation&apos;s acknowledgement is stale. It must be acknowledged again before the
          next approval.
        </p>
      ) : null}
      {offer.claimCover.status === "lapsed" ? (
        <p role="note">
          Claim cover has lapsed: restricted wording in the public text is no longer covered by an
          approved claim.
        </p>
      ) : null}
    </>
  );
}

export function OffersView({
  permissions,
  api = browserOffersApi,
}: {
  permissions: readonly string[];
  api?: OffersApi;
}) {
  const can = (p: string) => permissions.includes(p);
  const [offers, setOffers] = useState<OfferSummary[]>([]);
  const [scores, setScores] = useState<Scores | null>(null);
  const [detail, setDetail] = useState<OfferDetail | null>(null);
  const [versions, setVersions] = useState<OfferVersion[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [limit, setLimit] = useState("3");
  const [kind, setKind] = useState<"week" | "month">("month");
  const [sessionDate, setSessionDate] = useState("");

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
      run(async () => {
        const [list, s] = await Promise.all([api.list(), api.scores()]);
        setOffers(list.items);
        setScores(s);
      }),
    [api, run],
  );
  const open = useCallback(
    (id: string) =>
      run(async () => {
        const [d, v, b] = await Promise.all([api.get(id), api.versions(id), api.bookings(id)]);
        setDetail(d);
        setVersions(v.items);
        setBookings(b.items);
      }),
    [api, run],
  );
  useEffect(() => {
    void loadList();
  }, [loadList]);

  const refresh = async (id: string) => {
    await loadList();
    await open(id);
  };

  const move = (to: OfferStatus) => {
    if (!detail) return;
    if (note.trim().length < 3) {
      setError("Enter a note of at least 3 characters.");
      return;
    }
    void run(async () => {
      await api.moveStatus(detail.id, detail.latest.versionNo, to, note.trim(), newKey());
      setNote("");
      await refresh(detail.id);
    });
  };

  return (
    <main>
      <h1>Offers</h1>
      {error ? <p role="alert">{error}</p> : null}
      <ul aria-label="Offers">
        {offers.map((o) => (
          <li key={o.id}>
            <strong>
              Offer {o.number}: {o.name ?? "To be provided"}
            </strong>
            <span> Status: {label(o.status)}. </span>
            <span>{capacityText(o.capacity)}</span>
            <Notices offer={o} />
            <button type="button" onClick={() => void open(o.id)}>
              Open offer {o.number}
            </button>
          </li>
        ))}
      </ul>

      {detail ? (
        <section aria-label={`Offer ${detail.number}`}>
          <h2>
            Offer {detail.number}: {detail.name ?? "To be provided"}
          </h2>
          <p>
            Netspective effort estimate (hypothesis):{" "}
            {detail.latest.snapshot.effortEstimate.text ?? "to be provided"}
          </p>
          {detail.latest.placeholderAttributes.length > 0 ? (
            <p>Still to be provided: {detail.latest.placeholderAttributes.join(", ")}</p>
          ) : null}

          <h3>Limitations</h3>
          {detail.limitations.length === 0 ? <p>No limitations recorded.</p> : null}
          <ul aria-label="Limitations">
            {detail.limitations.map((l) => (
              <li key={l.id}>
                {l.wording}.{" "}
                {l.acknowledged
                  ? `Acknowledged by ${l.acknowledgedBy}.`
                  : l.acknowledgementStale
                    ? "Acknowledgement is stale."
                    : "Not acknowledged."}{" "}
                {can("offers.limitations.acknowledge") && !l.acknowledged ? (
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await api.acknowledge(detail.id, l.id, newKey());
                        await refresh(detail.id);
                      })
                    }
                  >
                    Acknowledge limitation
                  </button>
                ) : null}
              </li>
            ))}
          </ul>

          <h3>Version history</h3>
          <ul aria-label="Versions">
            {versions.map((v) => (
              <li key={v.versionNo}>
                Version {v.versionNo}: {label(v.status)}
                {v.superseded ? " (superseded)" : ""}. {v.history.length} status change
                {v.history.length === 1 ? "" : "s"}.
              </li>
            ))}
          </ul>

          {can("offers.status.change") && !detail.latest.superseded ? (
            <div>
              <label>
                Note for the status move
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              </label>
              <PhiWarning value={note} />
              {NEXT_STATUSES[detail.latest.status].map((to) => (
                <button key={to} type="button" onClick={() => move(to)}>
                  Move to {label(to)}
                </button>
              ))}
            </div>
          ) : null}

          <h3>Capacity</h3>
          <p>{capacityText(detail.capacity)}</p>
          {can("offers.capacity.edit") ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.setCapacity(
                    detail.id,
                    { periodKind: kind, limitSessions: Number(limit) },
                    newKey(),
                  );
                  await refresh(detail.id);
                });
              }}
            >
              <label>
                Period
                <select value={kind} onChange={(e) => setKind(e.target.value as "week" | "month")}>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </label>
              <label>
                Sessions
                <input
                  type="number"
                  min={0}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </label>
              <button type="submit">Save limit</button>
            </form>
          ) : null}

          <h3>Bookings</h3>
          <ul aria-label="Bookings">
            {bookings.map((b) => (
              <li key={b.id}>
                {b.sessionDate}: {label(b.state)} ({b.source})
                {can("offers.bookings.edit") && b.state === "booked" ? (
                  <button
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await api.updateBooking(detail.id, b.id, { state: "cancelled" }, newKey());
                        await refresh(detail.id);
                      })
                    }
                  >
                    Cancel session
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {can("offers.bookings.edit") ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.recordBooking(detail.id, { sessionDate }, newKey());
                  setSessionDate("");
                  await refresh(detail.id);
                });
              }}
            >
              <label>
                Session date
                <input
                  type="date"
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                />
              </label>
              <button type="submit">Record session</button>
            </form>
          ) : null}

          <h3>Scores</h3>
          <p>{scores?.label ?? "Scores are judgements and hypotheses."}</p>
          {scores && scores.scores.filter((s) => s.offerId === detail.id).length === 0 ? (
            <p>Scores are to be provided.</p>
          ) : null}
          <ul aria-label="Scores">
            {(scores?.scores ?? [])
              .filter((s) => s.offerId === detail.id)
              .map((s) => (
                <li key={s.criterionKey}>
                  {scores?.criteria.find((c) => c.key === s.criterionKey)?.label ?? s.criterionKey}:{" "}
                  {s.score} ({s.status})
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
