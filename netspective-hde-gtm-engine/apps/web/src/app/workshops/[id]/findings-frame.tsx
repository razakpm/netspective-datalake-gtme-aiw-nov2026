"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PhiWarning } from "../../../components/phi-warning.js";
import type {
  Finding,
  FindingsContent,
  FindingsView,
  SuggestedItem,
  Suggestion,
  WorkshopsApi,
} from "../../../lib/workshops-api.js";
import { useWork } from "./use-work.js";

// What both findings editors share (feature 007, spec FR-018 to FR-029): load, save, finalise, correct and
// the notes-assist. A suggestion fills the form without saving; an interpretive value (an owner or a status)
// is applied only when the person ticks it; the pasted notes are never saved.

export interface FindingsProps {
  workshopId: string;
  api: WorkshopsApi;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}

/** How one offer's editor turns saved content into form state and back. */
export interface Editor<F> {
  toForm: (content: FindingsContent) => F;
  toContent: (form: F) => FindingsContent;
  apply: (form: F, item: SuggestedItem) => F;
  describe: (form: F, path: string) => string;
}

const VALUE_TEXT: Record<string, string> = {
  known_good: "known good",
  not_quantified: "not quantified",
  rule_owner: "rule owner",
};

export function FindingsFrame<F>({
  workshopId,
  api,
  canEdit,
  onChanged,
  editor,
  children,
}: FindingsProps & {
  editor: Editor<F>;
  children: (form: F, set: (next: F) => void, view: FindingsView, locked: boolean) => ReactNode;
}) {
  const [view, setView] = useState<FindingsView | null>(null);
  const [form, setForm] = useState<F | null>(null);
  const [waiver, setWaiver] = useState("");
  const [correction, setCorrection] = useState("");
  const [notes, setNotes] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const { error, busy, run } = useWork();

  const read = useCallback(async () => {
    const next = await api.findings(workshopId);
    const content = next.current?.content ?? next.template;
    setView(next);
    setForm(content ? editor.toForm(content) : null);
    setDirty(false);
  }, [api, workshopId, editor]);
  useEffect(() => {
    void run(read);
  }, [read, run]);

  if (!view || !form) {
    return (
      <section aria-label="Findings">
        <h2>Findings</h2>
        {error ? <p role="alert">{error}</p> : <p>Loading…</p>}
      </section>
    );
  }
  const current: Finding | null = view.current;
  const finalised = current?.state === "finalised";
  const change = (next: F) => {
    setForm(next);
    setDirty(true);
  };
  const save = () =>
    run(async () => {
      await api.saveFindings(workshopId, {
        content: editor.toContent(form),
        ...(current ? { lockNo: current.lockNo } : {}),
        ...(finalised ? { correctionReason: correction } : {}),
      });
      setCorrection("");
      await read();
      await onChanged();
    });
  const finalise = () =>
    run(async () => {
      await api.finalise(workshopId, waiver.trim() ? { waiverReason: waiver.trim() } : {});
      setWaiver("");
      await read();
      await onChanged();
    });
  const suggest = () =>
    run(async () => {
      const result = await api.suggest(workshopId, notes);
      setSuggestion(result);
      setTicked(new Set());
      // Plain values go into the form at once; interpretations wait for a tick. Nothing is saved.
      const plain = result.items.filter((i) => !i.interpretation);
      // Applied to the form as it is now, so anything typed while waiting is kept.
      setForm((now) => (now === null ? now : plain.reduce(editor.apply, now)));
      setDirty(true);
    });
  const tick = (item: SuggestedItem) => {
    setTicked(new Set([...ticked, item.path]));
    change(editor.apply(form, item));
  };
  const waivable = view.shortfalls.some((s) => s.waivable);

  return (
    <section aria-label="Findings">
      <h2>Findings</h2>
      <p>
        {current
          ? `Version ${current.versionNo}, ${current.state}.`
          : "Nothing has been saved yet."}
        {current?.waiverReason ? ` Recorded shortfall: ${current.waiverReason}` : ""}
        {view.versions.length > 1 ? ` ${view.versions.length - 1} earlier version(s) kept.` : ""}
      </p>
      {error ? <p role="alert">{error}</p> : null}

      {canEdit ? (
        <fieldset>
          <legend>Suggest from my notes</legend>
          <label>
            Session notes (used once, never saved)
            <textarea value={notes} maxLength={8000} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <PhiWarning value={notes} />
          <button
            type="button"
            disabled={busy || notes.trim().length < 20}
            onClick={() => void suggest()}
          >
            Suggest from my notes
          </button>
          {suggestion ? (
            <>
              <p role="status">
                {suggestion.items.length} suggestion(s), confidence {suggestion.confidence}.{" "}
                {suggestion.rationale} Check each one, then save.
                {suggestion.notice ? ` ${suggestion.notice}` : ""}
              </p>
              <ul aria-label="Suggestions">
                {suggestion.items.map((item) => {
                  const text = `${editor.describe(form, item.path)}: ${VALUE_TEXT[String(item.value)] ?? item.value}`;
                  return (
                    <li key={item.path}>
                      {item.interpretation ? (
                        <label>
                          <input
                            type="checkbox"
                            checked={ticked.has(item.path)}
                            disabled={ticked.has(item.path)}
                            onChange={() => tick(item)}
                          />
                          Apply {text}
                        </label>
                      ) : (
                        <span>Filled in {text}</span>
                      )}{" "}
                      <q>{item.supportingText}</q>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset disabled={!canEdit}>
        <legend>Entries</legend>
        {children(form, change, view, !canEdit)}
      </fieldset>

      <h3>Still needed</h3>
      {dirty ? <p>Save to check these again.</p> : null}
      {view.shortfalls.length === 0 ? (
        <p>Nothing: these findings can be finalised.</p>
      ) : (
        <ul aria-label="Still needed">
          {view.shortfalls.map((s) => (
            <li key={s.code}>
              {s.message}
              {s.waivable ? " (can be finalised with a reason)" : ""}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <>
          {finalised ? (
            <label>
              Reason for the correction
              <input
                value={correction}
                maxLength={300}
                onChange={(e) => setCorrection(e.target.value)}
              />
            </label>
          ) : null}
          <button
            type="button"
            disabled={busy || (finalised && correction.trim().length < 3)}
            onClick={() => void save()}
          >
            {finalised ? "Save as a correction" : "Save draft"}
          </button>
          {current?.state === "draft" ? (
            <>
              {waivable ? (
                <label>
                  Reason for finalising with a shortfall (at least ten characters)
                  <input
                    value={waiver}
                    maxLength={300}
                    onChange={(e) => setWaiver(e.target.value)}
                  />
                </label>
              ) : null}
              <PhiWarning value={`${waiver} ${correction}`} />
              <button type="button" disabled={busy || dirty} onClick={() => void finalise()}>
                Finalise
              </button>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
