"use client";
import { useCallback, useEffect, useState } from "react";
import { PhiWarning } from "../../../components/phi-warning.js";
import type { Output, OutputView, WorkshopsApi } from "../../../lib/workshops-api.js";
import { lines, useWork } from "./use-work.js";

// The buyer's one-page output (feature 007, spec FR-030 to FR-032). The parts built from the findings are
// shown read-only. Approval needs its own permission; sharing is recorded here and nothing is sent.

interface Form {
  title: string;
  summary: string;
  nextStep: string;
  inScope: string;
  outOfScope: string;
}
const formOf = (o: Output): Form => ({
  title: o.sections.title,
  summary: o.sections.summary,
  nextStep: o.sections.nextStep,
  inScope: o.sections.inScope.join("\n"),
  outOfScope: o.sections.outOfScope.join("\n"),
});
const HOW = { handed_over: "Handed over", copied_link: "Copied a link", other: "Another way" };

export function OutputPanel({
  workshopId,
  api,
  canEdit,
  canApprove,
}: {
  workshopId: string;
  api: WorkshopsApi;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const [view, setView] = useState<OutputView | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [how, setHow] = useState<keyof typeof HOW>("handed_over");
  const [note, setNote] = useState("");
  const { error, busy, run } = useWork();
  const read = useCallback(async () => {
    const next = await api.output(workshopId);
    setView(next);
    setForm(next.latest ? formOf(next.latest) : null);
  }, [api, workshopId]);
  useEffect(() => {
    void run(read);
  }, [read, run]);
  const act = (work: () => Promise<unknown>) =>
    run(async () => {
      await work();
      await read();
    });

  const latest = view?.latest ?? null;
  const s = latest?.sections;
  const dirty =
    latest !== null && form !== null && JSON.stringify(form) !== JSON.stringify(formOf(latest));
  const shareable = latest?.state === "approved" && !latest.outOfDate;
  const area = (label: string, key: keyof Form, max?: number) => (
    <label>
      {label}
      <textarea
        value={form![key]}
        maxLength={max}
        onChange={(e) => setForm({ ...form!, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <section aria-label="Buyer output">
      <h2>One-page output</h2>
      {error ? <p role="alert">{error}</p> : null}
      {canEdit ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void act(() => api.generateOutput(workshopId))}
        >
          {latest ? "Make a new draft from the findings" : "Make a draft"}
        </button>
      ) : null}
      {!latest || !s || !form ? (
        <p>No page yet. It is made from finalised findings.</p>
      ) : (
        <>
          <p>
            Revision {latest.revisionNo}, {latest.state}, from findings version{" "}
            {latest.findingVersionNo}.
          </p>
          {latest.outOfDate ? (
            <p role="note">
              Out of date: the findings changed after this page was made. Make a new draft.
            </p>
          ) : null}
          <article aria-label="Preview">
            <h3>{s.title}</h3>
            <p>
              {s.organisation} · {s.offerName} · {s.date}
            </p>
            {[
              ["Summary", s.summary],
              ["Findings", s.findings],
              ["Unknowns", s.unknowns],
              ["Next step", s.nextStep],
            ].map(([heading, text]) => (
              <div key={heading}>
                <h4>{heading}</h4>
                <p style={{ whiteSpace: "pre-line" }}>{text}</p>
              </div>
            ))}
            {[
              ["In scope", s.inScope],
              ["Out of scope", s.outOfScope],
            ].map(([heading, items]) => (
              <div key={heading as string}>
                <h4>{heading as string}</h4>
                <ul>
                  {(items as string[]).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
            {s.boundaryNote ? <p>{s.boundaryNote}</p> : null}
            {s.disclaimer ? <p>{s.disclaimer}</p> : null}
          </article>

          {canEdit && !latest.outOfDate ? (
            <form
              aria-label="Edit the page"
              onSubmit={(e) => {
                e.preventDefault();
                void act(() =>
                  api.editOutput(workshopId, {
                    baseRevisionNo: latest.revisionNo,
                    sections: {
                      title: form.title,
                      summary: form.summary,
                      nextStep: form.nextStep,
                      inScope: lines(form.inScope),
                      outOfScope: lines(form.outOfScope),
                    },
                  }),
                );
              }}
            >
              <p>Findings, unknowns and the fixed notes come from the findings.</p>
              {area("Title", "title", 200)}
              {area("Summary", "summary", 1200)}
              {area("Next step", "nextStep", 500)}
              {area("In scope, one per line", "inScope")}
              {area("Out of scope, one per line", "outOfScope")}
              <PhiWarning value={Object.values(form).join(" ")} />
              <button
                type="submit"
                disabled={
                  busy ||
                  !dirty ||
                  lines(form.inScope).length === 0 ||
                  lines(form.outOfScope).length === 0
                }
              >
                Save as a new revision
              </button>
            </form>
          ) : null}

          {latest.problems.length > 0 ? (
            <ul aria-label="Before approval">
              {latest.problems.map((p) => (
                <li key={p.code}>{p.message}</li>
              ))}
            </ul>
          ) : null}
          {canApprove && latest.state === "draft" && !latest.outOfDate ? (
            <button
              type="button"
              disabled={busy || dirty || latest.problems.length > 0}
              onClick={() => void act(() => api.approveOutput(workshopId))}
            >
              Approve and make the PDF
            </button>
          ) : null}

          {shareable ? (
            <>
              <p>
                <a href={`/api/v1/workshops/${encodeURIComponent(workshopId)}/output/pdf`}>
                  Download the PDF
                </a>
              </p>
              {canEdit ? (
                <form
                  aria-label="Record that it was shared"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      await api.shareOutput(workshopId, { how, ...(note ? { note } : {}) });
                      setNote("");
                    });
                  }}
                >
                  <p>This records what you did. Nothing is sent from here.</p>
                  <label>
                    How it was shared
                    <select value={how} onChange={(e) => setHow(e.target.value as typeof how)}>
                      {Object.entries(HOW).map(([key, text]) => (
                        <option key={key} value={key}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Note
                    <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <PhiWarning value={note} />
                  <button type="submit" disabled={busy}>
                    Record sharing
                  </button>
                </form>
              ) : null}
            </>
          ) : null}
          {view && view.shares.length > 0 ? (
            <ul aria-label="Shares">
              {view.shares.map((share) => (
                <li key={share.id}>
                  {HOW[share.how as keyof typeof HOW] ?? share.how} ·{" "}
                  {new Date(share.sharedAt).toLocaleString()}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
