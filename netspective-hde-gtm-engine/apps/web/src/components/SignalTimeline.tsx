import {
  CONFIDENCE_DEFINITIONS,
  RELIABILITY_DEFINITIONS,
  type SignalSummary,
} from "../lib/signals-api.js";

// Account signal timeline (task T062): the same data as the feed, chronological, with current, stale,
// pending and contradictory signals clearly distinguished. Reusable; mounted on the account screen later.

export function signalBadges(s: SignalSummary): string[] {
  const out: string[] = [];
  if (s.reviewStatus === "pending") out.push("pending review");
  if (s.reviewStatus === "rejected") out.push("rejected");
  if (s.reviewStatus === "contradictory") out.push("contradictory");
  if (s.isCurrent) out.push("current evidence");
  if (s.stale) out.push("stale");
  if (s.undated) out.push("undated");
  if (s.flags.newProvenanceSinceReview) out.push("new provenance since review");
  if (s.flags.reverifyRequired) out.push("re-verify before external use");
  if (s.flags.contextOnly) out.push("context only");
  if (s.fundingClass === "context") out.push("funding context");
  if (s.statusLabel === "hypothesis") out.push("hypothesis default");
  return out;
}

export function SignalRow({ signal }: { signal: SignalSummary }) {
  return (
    <article aria-label={`Signal ${signal.typeKey}`}>
      <h3>
        {signal.category} · {signal.typeKey}
      </h3>
      <p>{signal.observation}</p>
      {signal.excerpt ? <blockquote>{signal.excerpt}</blockquote> : null}
      {signal.excerptWithheldReason !== "none" ? (
        <p>
          Excerpt withheld:{" "}
          {signal.excerptWithheldReason === "too_long"
            ? "too long"
            : "source does not permit storage"}
          .{" "}
          <a href={signal.source.ref} rel="noreferrer">
            Open the citation
          </a>
        </p>
      ) : null}
      <p>
        Source: {signal.source.name} ({signal.source.ref})
        {signal.source.unavailableSince
          ? ` — unavailable since ${signal.source.unavailableSince}`
          : ""}
      </p>
      <p>
        Observed {signal.observedAt.slice(0, 10)} · Review: {signal.reviewStatus} · Evidence status:{" "}
        {signal.evidenceStatus}
      </p>
      <p title={RELIABILITY_DEFINITIONS[signal.reliability]}>
        Reliability: {signal.reliability} — {RELIABILITY_DEFINITIONS[signal.reliability]}
      </p>
      <p title={CONFIDENCE_DEFINITIONS[signal.extractionConfidence]}>
        Extraction confidence: {signal.extractionConfidence}
      </p>
      <ul aria-label="Badges">
        {signalBadges(signal).map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </article>
  );
}

export function SignalTimeline({ signals }: { signals: SignalSummary[] }) {
  if (signals.length === 0) return <p>No signals recorded for this organisation.</p>;
  const ordered = [...signals].sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1));
  return (
    <section aria-label="Signal timeline">
      {ordered.map((s) => (
        <SignalRow key={s.id} signal={s} />
      ))}
    </section>
  );
}
