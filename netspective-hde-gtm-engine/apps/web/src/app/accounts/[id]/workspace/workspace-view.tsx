"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PhiWarning } from "../../../../components/phi-warning.js";
import { SignalTimeline } from "../../../../components/SignalTimeline.js";
import {
  describeFlag,
  describeStatusRefusal,
  hypothesesApi,
  type Hypothesis,
  type HypothesesApi,
  type HypothesisStatus,
  type HypothesisSummary,
} from "../../../../lib/hypotheses-api.js";
import {
  call,
  describeResearchError,
  newKey,
  ResearchApiError,
  type AccountSummary,
  type RunView,
  type StartRunBody,
} from "../../../../lib/research-api.js";
import { browserSignalsApi, type SignalSummary } from "../../../../lib/signals-api.js";
import type { RecommendationsApi } from "../../../../lib/recommendations-api.js";
import { RecommendationPanel } from "./recommendation-panel.js";

// Target Account Workspace v1 (task T060; spec FR-041): profile, ICP, signals, hypotheses with evidence
// drill-down, the latest summary's unknowns and contradictions, and runs with cost. Controls appear only for
// users who hold the permission; the API enforces every permission regardless.

export interface AccountProfile {
  name: string;
  orgType: string;
  geography?: string;
  fit: Record<string, string>;
  domains: { domain: string }[];
}

export interface WorkspaceApi {
  account(id: string): Promise<AccountProfile>;
  signals(id: string): Promise<{ items: SignalSummary[] }>;
  summary(id: string): Promise<AccountSummary>;
  runs(id: string): Promise<{ items: RunView[] }>;
  startRun(id: string, body: StartRunBody, key: string): Promise<RunView>;
  cancelRun(id: string, key: string): Promise<RunView>;
  acknowledge(id: string, note: string, key: string): Promise<RunView>;
  hypotheses: HypothesesApi;
}

export const browserWorkspaceApi: WorkspaceApi = {
  account: (id) => call("GET", `/accounts/${encodeURIComponent(id)}`),
  signals: (id) => browserSignalsApi.accountSignals(id),
  summary: (id) => call("GET", `/accounts/${encodeURIComponent(id)}/research-summary`),
  runs: (id) => call("GET", `/accounts/${encodeURIComponent(id)}/research`),
  startRun: (id, body, key) =>
    call("POST", `/accounts/${encodeURIComponent(id)}/research`, key, body),
  cancelRun: (id, key) => call("POST", `/research-runs/${encodeURIComponent(id)}/cancel`, key),
  acknowledge: (id, note, key) =>
    call("POST", `/research-runs/${encodeURIComponent(id)}/acknowledge`, key, { note }),
  hypotheses: hypothesesApi,
};

const STATUSES: HypothesisStatus[] = [
  "untested",
  "strengthening",
  "weakening",
  "validated",
  "rejected",
];

export function WorkspaceView({
  accountId,
  permissions,
  api = browserWorkspaceApi,
  recommendationsApi,
}: {
  accountId: string;
  permissions: readonly string[];
  api?: WorkspaceApi;
  recommendationsApi?: RecommendationsApi;
}) {
  const can = (p: string) => permissions.includes(p);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [signals, setSignals] = useState<SignalSummary[]>([]);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [accepted, setAccepted] = useState<HypothesisSummary[]>([]);
  const [proposed, setProposed] = useState<HypothesisSummary[]>([]);
  const [selected, setSelected] = useState<Hypothesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.account(accountId),
      api.signals(accountId),
      api.summary(accountId),
      api.runs(accountId),
      api.hypotheses.list(accountId, "accepted"),
      api.hypotheses.list(accountId, "proposed"),
    ])
      .then(([p, s, sum, r, a, pr]) => {
        setProfile(p);
        setSignals(s.items);
        setSummary(sum);
        setRuns(r.items);
        setAccepted(a.items);
        setProposed(pr.items);
        setError(null);
      })
      .catch((e: unknown) => setError(describeResearchError(e)));
  }, [api, accountId]);
  useEffect(load, [load]);

  async function open(id: string) {
    try {
      setSelected(await api.hypotheses.get(id));
      setStatusMessage(null);
    } catch (e) {
      setError(describeResearchError(e));
    }
  }
  async function act(fn: () => Promise<unknown>, after?: () => void) {
    try {
      await fn();
      after?.();
      load();
    } catch (e) {
      setError(describeResearchError(e));
    }
  }

  const excluded =
    runs[0]?.icpExcluded === true ||
    accepted.some((h) => h.notForPrioritisation) ||
    proposed.some((h) => h.notForPrioritisation);

  return (
    <main>
      <h1>{profile?.name ?? "Account workspace"}</h1>
      {error ? <p role="alert">{error}</p> : null}
      {excluded ? (
        <p role="status">
          This account is excluded or on hold by the ICP rules. Research never changes that, and its
          hypotheses are not for prioritisation.
        </p>
      ) : null}

      <section aria-label="Profile and ICP">
        <h2>Profile and ICP</h2>
        {profile ? (
          <>
            <p>
              {profile.orgType}
              {profile.geography ? ` · ${profile.geography}` : ""}
              {profile.domains.length
                ? ` · ${profile.domains.map((d) => d.domain).join(", ")}`
                : ""}
            </p>
            <p>
              ICP fit:{" "}
              {Object.keys(profile.fit).length === 0
                ? "not assessed yet"
                : Object.entries(profile.fit)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(", ")}
            </p>
          </>
        ) : null}
      </section>

      <section aria-label="Signals">
        <h2>Signals</h2>
        <SignalTimeline signals={signals} />
      </section>

      <section aria-label="Hypotheses">
        <h2>Hypotheses</h2>
        <p>
          A hypothesis is a testable statement, not a conclusion. Confidence is a band, never a
          number.
        </p>
        {proposed.length > 0 ? (
          <div aria-label="Proposals">
            <h3>AI-proposed, not accepted</h3>
            {proposed.map((h) => (
              <article key={h.id} aria-label={`Proposal ${h.id}`}>
                <p>
                  <strong>{h.label}</strong> {h.statement}
                </p>
                {can("hypotheses.edit") ? (
                  <>
                    <button
                      type="button"
                      onClick={() => act(() => api.hypotheses.accept(h.id, newKey()))}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => act(() => api.hypotheses.dismiss(h.id, newKey()))}
                    >
                      Dismiss
                    </button>
                  </>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
        {accepted.length === 0 ? <p>No accepted hypotheses yet.</p> : null}
        <ul>
          {accepted.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => open(h.id)}>
                {h.statement}
              </button>{" "}
              <span>{h.effectiveStatus}</span>
              {h.effectiveStatus === "stale" && h.status !== "stale" ? (
                <span> (stale by rule)</span>
              ) : null}
              {h.flaggedForReview ? <span> · needs review</span> : null}
              {h.notForPrioritisation ? <span> · not for prioritisation</span> : null}
            </li>
          ))}
        </ul>
        {selected ? (
          <HypothesisDetail
            h={selected}
            canReview={can("hypotheses.review")}
            canEdit={can("hypotheses.edit")}
            message={statusMessage}
            onStatus={async (status, note) => {
              try {
                const updated = await api.hypotheses.changeStatus(
                  selected.id,
                  status,
                  note,
                  newKey(),
                );
                setSelected(updated);
                setStatusMessage(null);
                load();
              } catch (e) {
                setStatusMessage(
                  e instanceof ResearchApiError
                    ? describeStatusRefusal(e.codes)
                    : describeResearchError(e),
                );
              }
            }}
            onAssumption={(text) =>
              act(async () =>
                setSelected(await api.hypotheses.addAssumption(selected.id, text, newKey())),
              )
            }
          />
        ) : null}
      </section>

      <section aria-label="Research summary">
        <h2>Research summary</h2>
        <p>{summary?.label ?? "AI-generated, advisory"}</p>
        <SummaryGroups summary={summary} />
      </section>

      <section aria-label="Research runs">
        <h2>Research runs</h2>
        {can("research.run") ? (
          <StartRun onStart={(body) => act(() => api.startRun(accountId, body, newKey()))} />
        ) : null}
        {runs.length === 0 ? <p>No research runs yet.</p> : null}
        <ul>
          {runs.map((r) => (
            <li key={r.id}>
              <span>{r.state.replace("_", " ")}</span> · cost {r.totals.cost} of {r.budget.maxCost}{" "}
              · {r.totals.sourcesRead} of {r.budget.maxSources} sources
              {r.totals.injectionFlags > 0 ? (
                <span> · {r.totals.injectionFlags} injection flag(s)</span>
              ) : null}
              {can("research.run") && (r.state === "queued" || r.state === "running") ? (
                <button type="button" onClick={() => act(() => api.cancelRun(r.id, newKey()))}>
                  Cancel run
                </button>
              ) : null}
              {r.state === "needs_attention" &&
              !r.attention?.acknowledgedAt &&
              (can("research.run") || can("hypotheses.review")) ? (
                <button
                  type="button"
                  onClick={() =>
                    act(() => api.acknowledge(r.id, "Reviewed in the workspace.", newKey()))
                  }
                >
                  Acknowledge
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {can("offers.read") ? (
        <RecommendationPanel
          accountId={accountId}
          permissions={permissions}
          {...(recommendationsApi ? { api: recommendationsApi } : {})}
        />
      ) : null}
    </main>
  );
}

function SummaryGroups({ summary }: { summary: AccountSummary | null }) {
  if (!summary || summary.runId === null) return <p>No research summary yet.</p>;
  const origin = (f: {
    source: { address: string } | null;
    flaggedSource: boolean;
    carriedOver: boolean;
  }) =>
    `${f.source?.address ?? ""}${f.flaggedSource ? " (flagged source)" : ""}${f.carriedOver ? " (carried over)" : ""}`;
  return (
    <>
      <div aria-label="Facts as stated">
        <h3>Facts as stated by a source</h3>
        <ul>
          {summary.facts.map((f) => (
            <li key={f.id}>
              {f.statement} <small>{origin(f)}</small>
            </li>
          ))}
        </ul>
      </div>
      <div aria-label="Inferences">
        <h3>Inferences</h3>
        <ul>
          {summary.inferences.map((f) => (
            <li key={f.id}>{f.statement}</li>
          ))}
        </ul>
      </div>
      <div aria-label="Unknowns">
        <h3>Unknowns</h3>
        <ul>
          {summary.unknowns.map((u) => (
            <li key={u.topic}>{u.statement}</li>
          ))}
        </ul>
      </div>
      <div aria-label="Contradictions">
        <h3>Contradictions</h3>
        {summary.contradictions.length === 0 ? <p>None found.</p> : null}
        <ul>
          {summary.contradictions.map((f) => (
            <li key={f.id}>
              {f.statement}{" "}
              <small>
                {f.source?.address} and {f.secondSource?.address}
              </small>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function StartRun({ onStart }: { onStart: (body: StartRunBody) => void }) {
  const [addresses, setAddresses] = useState("");
  const [maxSources, setMaxSources] = useState("10");
  const [maxCost, setMaxCost] = useState("2.00");
  function submit(e: FormEvent) {
    e.preventDefault();
    const list = addresses
      .split("\n")
      .map((a) => a.trim())
      .filter(Boolean);
    onStart({
      maxSources: Number(maxSources),
      maxCost,
      ...(list.length ? { sources: list.map((address) => ({ address })) } : {}),
    });
    setAddresses("");
  }
  return (
    <form onSubmit={submit} aria-label="Start research run">
      <label>
        Source addresses (one per line, approved sources only)
        <textarea value={addresses} onChange={(e) => setAddresses(e.target.value)} />
      </label>
      <PhiWarning value={addresses} />
      <label>
        Maximum sources
        <input
          type="number"
          min={1}
          max={25}
          value={maxSources}
          onChange={(e) => setMaxSources(e.target.value)}
        />
      </label>
      <label>
        Maximum cost
        <input value={maxCost} onChange={(e) => setMaxCost(e.target.value)} />
      </label>
      <p>
        Defaults are hypotheses: 10 sources and a cost cap of 2.00 per run; each account also has a
        monthly cap.
      </p>
      <button type="submit">Start run</button>
    </form>
  );
}

function HypothesisDetail({
  h,
  canReview,
  canEdit,
  message,
  onStatus,
  onAssumption,
}: {
  h: Hypothesis;
  canReview: boolean;
  canEdit: boolean;
  message: string | null;
  onStatus: (status: HypothesisStatus, note: string) => void;
  onAssumption: (text: string) => void;
}) {
  const [status, setStatus] = useState<HypothesisStatus>("strengthening");
  const [note, setNote] = useState("");
  const [assumption, setAssumption] = useState("");
  const signalList = (items: Hypothesis["supporting"]) =>
    items.length === 0 ? (
      <p>None.</p>
    ) : (
      <ul>
        {items.map((s) => (
          <li key={s.signalId}>
            {s.observation}{" "}
            <small>
              [{s.evidenceStatus}; {s.reviewStatus}
              {s.isCurrent ? "; counts as current evidence" : "; not counted as current evidence"}]
            </small>
          </li>
        ))}
      </ul>
    );
  return (
    <article aria-label="Hypothesis detail">
      <h3>{h.statement}</h3>
      <p>
        Status: {h.effectiveStatus} · Confidence: {h.confidence.band} — {h.confidence.explanation}
      </p>
      <p>{h.definitions[h.confidence.band]}</p>
      {h.flaggedForReview ? <p role="note">{describeFlag(h.flagReason)}</p> : null}
      <h4>Supporting signals</h4>
      {signalList(h.supporting)}
      <h4>Contradictory signals</h4>
      {signalList(h.contradictory)}
      <h4>Buyer-confirmed facts</h4>
      {signalList(h.buyerConfirmedFacts)}
      <h4>Assumptions</h4>
      {h.assumptions.length === 0 ? <p>None.</p> : null}
      <ul>
        {h.assumptions.map((a, i) => (
          <li key={i}>
            {a.text} <small>(assumption, {a.source})</small>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          aria-label="Add assumption"
          onSubmit={(e) => {
            e.preventDefault();
            onAssumption(assumption.trim());
            setAssumption("");
          }}
        >
          <label>
            Assumption
            <input
              value={assumption}
              onChange={(e) => setAssumption(e.target.value)}
              required
              minLength={3}
            />
          </label>
          <PhiWarning value={assumption} />
          <button type="submit">Add assumption</button>
        </form>
      ) : null}
      <h4>Status history</h4>
      {h.statusHistory.length === 0 ? <p>No status changes yet.</p> : null}
      <ul>
        {h.statusHistory.map((d, i) => (
          <li key={i}>
            {d.fromStatus ?? "start"} → {d.toStatus} by{" "}
            {d.decidedByType === "system" ? "the stale rule" : d.decidedBy}: {d.note}
          </li>
        ))}
      </ul>
      {canReview ? (
        <form
          aria-label="Change status"
          onSubmit={(e) => {
            e.preventDefault();
            onStatus(status, note.trim());
          }}
        >
          <label>
            New status
            <select value={status} onChange={(e) => setStatus(e.target.value as HypothesisStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} />
          </label>
          <PhiWarning value={note} />
          {message ? <p role="alert">{message}</p> : null}
          <button type="submit">Save status</button>
        </form>
      ) : null}
    </article>
  );
}
