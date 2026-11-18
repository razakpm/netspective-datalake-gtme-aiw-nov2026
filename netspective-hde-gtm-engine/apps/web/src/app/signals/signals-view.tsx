"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PhiWarning } from "../../components/phi-warning.js";
import { SignalRow } from "../../components/SignalTimeline.js";
import {
  browserSignalsApi,
  describeSignalsError,
  newSignalKey,
  type FeedFilters,
  type ReviewStatus,
  type SignalSummary,
  type SignalsApi,
} from "../../lib/signals-api.js";

// Signal Feed (task T059): nine filters, review decisions for reviewers, and a record form.
const FILTER_FIELDS: { name: keyof FeedFilters; label: string }[] = [
  { name: "type", label: "Type" },
  { name: "icp", label: "ICP" },
  { name: "accountId", label: "Organisation" },
  { name: "sourceId", label: "Source" },
  { name: "capability", label: "Capability" },
  { name: "offer", label: "Offer" },
  { name: "confidence", label: "Confidence" },
];

export function SignalsView({
  api = browserSignalsApi,
  canReview = false,
  canRecord = false,
}: {
  api?: SignalsApi;
  canReview?: boolean;
  canRecord?: boolean;
}) {
  const [filters, setFilters] = useState<FeedFilters>({});
  const [items, setItems] = useState<SignalSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [contradicting, setContradicting] = useState<string | null>(null);
  const [otherId, setOtherId] = useState("");

  const load = useCallback(() => {
    const active = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as FeedFilters;
    api
      .list(active)
      .then((page) => {
        setItems(page.items);
        setError(null);
      })
      .catch((e: unknown) => setError(describeSignalsError(e)));
  }, [api, filters]);
  useEffect(load, [load]);

  async function decide(
    id: string,
    body: {
      decision: "approve" | "reject" | "contradict" | "clear_flag" | "reverify";
      reason?: string;
      contradictsSignalId?: string;
    },
  ) {
    try {
      await api.review(id, body, newSignalKey());
      setRejecting(null);
      setContradicting(null);
      setReason("");
      setOtherId("");
      load();
    } catch (e) {
      setError(describeSignalsError(e));
    }
  }

  return (
    <section>
      <h1>Signal Feed</h1>
      <p>Signals are observations, not conclusions. Defaults shown here are hypotheses.</p>
      {error ? <p role="alert">{error}</p> : null}
      <form aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        {FILTER_FIELDS.map((f) => (
          <label key={f.name}>
            {f.label}
            <input
              value={(filters[f.name] as string | undefined) ?? ""}
              onChange={(e) => setFilters({ ...filters, [f.name]: e.target.value })}
            />
          </label>
        ))}
        <label>
          Freshness
          <select
            value={filters.freshness ?? ""}
            onChange={(e) =>
              setFilters({
                ...filters,
                freshness: (e.target.value || undefined) as FeedFilters["freshness"],
              })
            }
          >
            <option value="">Any</option>
            <option value="fresh">Fresh</option>
            <option value="stale">Stale</option>
            <option value="undated">Undated</option>
          </select>
        </label>
        <label>
          Review status
          <select
            value={filters.reviewStatus ?? ""}
            onChange={(e) =>
              setFilters({
                ...filters,
                reviewStatus: (e.target.value || undefined) as ReviewStatus | undefined,
              })
            }
          >
            <option value="">Any</option>
            <option value="pending">Pending review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="contradictory">Contradictory</option>
          </select>
        </label>
      </form>
      {items.length === 0 ? <p>No signals match these filters.</p> : null}
      {items.map((s) => (
        <div key={s.id}>
          <SignalRow signal={s} />
          {canReview ? (
            <div role="group" aria-label={`Decisions for ${s.typeKey}`}>
              <button type="button" onClick={() => decide(s.id, { decision: "approve" })}>
                Approve
              </button>
              <button type="button" onClick={() => setRejecting(s.id)}>
                Reject
              </button>
              <button type="button" onClick={() => setContradicting(s.id)}>
                Mark contradictory
              </button>
              {s.flags.newProvenanceSinceReview ? (
                <button type="button" onClick={() => decide(s.id, { decision: "clear_flag" })}>
                  Clear new-provenance flag
                </button>
              ) : null}
              {s.flags.reverifyRequired ? (
                <button type="button" onClick={() => setRejecting(`reverify:${s.id}`)}>
                  Re-verify
                </button>
              ) : null}
              {rejecting === s.id || rejecting === `reverify:${s.id}` ? (
                <form
                  aria-label="Reason"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void decide(s.id, {
                      decision: rejecting === s.id ? "reject" : "reverify",
                      reason: reason.trim(),
                    });
                  }}
                >
                  <label>
                    Reason
                    <input
                      required
                      minLength={3}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <PhiWarning value={reason} />
                  <button type="submit">Save decision</button>
                </form>
              ) : null}
              {contradicting === s.id ? (
                <form
                  aria-label="Contradiction"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void decide(s.id, {
                      decision: "contradict",
                      contradictsSignalId: otherId.trim(),
                    });
                  }}
                >
                  <label>
                    Contradicts signal
                    <select required value={otherId} onChange={(e) => setOtherId(e.target.value)}>
                      <option value="">Choose a signal</option>
                      {items
                        .filter((o) => o.id !== s.id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.typeKey}: {o.observation.slice(0, 40)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button type="submit">Save decision</button>
                </form>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      {canRecord ? <RecordForm api={api} onRecorded={load} /> : null}
    </section>
  );
}

function RecordForm({ api, onRecorded }: { api: SignalsApi; onRecorded: () => void }) {
  const [form, setForm] = useState({
    accountId: "",
    typeKey: "",
    sourceId: "",
    ref: "",
    observation: "",
    excerpt: "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api.record(
        {
          accountId: form.accountId.trim(),
          typeKey: form.typeKey.trim(),
          observation: form.observation.trim(),
          observedAt: new Date().toISOString(),
          ...(form.excerpt.trim() ? { excerpt: form.excerpt.trim() } : {}),
          source: { sourceId: form.sourceId.trim(), ref: form.ref.trim() },
        },
        newSignalKey(),
      );
      setForm({ accountId: "", typeKey: "", sourceId: "", ref: "", observation: "", excerpt: "" });
      setError(null);
      onRecorded();
    } catch (e) {
      setError(describeSignalsError(e));
    }
  }

  return (
    <form onSubmit={submit} aria-label="Record signal">
      <h2>Record a signal</h2>
      {error ? <p role="alert">{error}</p> : null}
      <label>
        Organisation id
        <input required value={form.accountId} onChange={set("accountId")} />
      </label>
      <label>
        Signal type
        <input required value={form.typeKey} onChange={set("typeKey")} />
      </label>
      <label>
        Source id
        <input required value={form.sourceId} onChange={set("sourceId")} />
      </label>
      <label>
        URL or identifier
        <input required value={form.ref} onChange={set("ref")} />
      </label>
      <label>
        Observation
        <textarea
          required
          minLength={3}
          maxLength={1000}
          value={form.observation}
          onChange={set("observation")}
        />
      </label>
      <PhiWarning value={form.observation} />
      <label>
        Excerpt (kept only if short and the source permits it)
        <textarea maxLength={1000} value={form.excerpt} onChange={set("excerpt")} />
      </label>
      <PhiWarning value={form.excerpt} />
      <button type="submit">Record signal</button>
    </form>
  );
}
