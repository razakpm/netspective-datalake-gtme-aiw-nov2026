"use client";
import { useCallback, useEffect, useState } from "react";
import type { Brief, Workshop, WorkshopsApi } from "../../../lib/workshops-api.js";
import { useWork } from "./use-work.js";

// The preparation brief (feature 007, spec FR-010 to FR-013). Advice for the delivery engineer: facts are
// shown in the evidence's own words, apart from inferences, contradictions and unknowns.

function List({ heading, items }: { heading: string; items: { key: string; text: string }[] }) {
  return (
    <>
      <h3>{heading}</h3>
      {items.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul aria-label={heading}>
          {items.map((item) => (
            <li key={item.key}>{item.text}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function BriefPanel({
  workshop,
  api,
  canEdit,
}: {
  workshop: Pick<Workshop, "id" | "state">;
  api: WorkshopsApi;
  canEdit: boolean;
}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [earlier, setEarlier] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const { error, busy, run } = useWork();
  const load = useCallback(
    () =>
      run(async () => {
        const result = await api.brief(workshop.id);
        setBrief(result.latest);
        setEarlier(result.earlier.length);
      }),
    [api, workshop.id, run],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const open = !["cancelled", "no_show", "closed"].includes(workshop.state);
  const content = brief?.content;

  return (
    <section aria-label="Preparation brief">
      <h2>Preparation brief</h2>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="note">{notice}</p> : null}
      {canEdit && open ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setNotice((await api.generateBrief(workshop.id)).notice);
              await load();
            })
          }
        >
          {brief ? "Make a new brief" : "Make a brief"}
        </button>
      ) : null}
      {!brief || !content ? (
        <p>No brief yet.</p>
      ) : (
        <>
          <p>
            Version {brief.versionNo} ·{" "}
            {brief.source === "model"
              ? `drafted by ${brief.model} (prompt ${brief.promptVersion}), confidence ${brief.confidence}`
              : "checklist from the records, no model"}{" "}
            · {brief.reviewStatus}
            {earlier > 0 ? ` · ${earlier} earlier version(s) superseded` : ""}
          </p>
          {brief.rationale ? <p>{brief.rationale}</p> : null}
          <List
            heading="Confirmed facts"
            items={content.confirmedFacts.map((f) => ({ key: f.evidenceId, text: f.text }))}
          />
          <List
            heading="Inferences (not facts)"
            items={content.inferences.map((i, n) => ({
              key: String(n),
              text: `${i.statement} — ${i.basis} Evidence: ${i.evidenceIds.length}; contradicting: ${i.contradictingEvidenceIds.length}.`,
            }))}
          />
          <List
            heading="Contradicting evidence"
            items={content.contradictions.map((c) => ({ key: c.evidenceId, text: c.text }))}
          />
          <List heading="Unknowns" items={content.unknowns.map((u) => ({ key: u, text: u }))} />
          <List
            heading="Suggested questions"
            items={content.suggestedQuestions.map((q) => ({ key: q, text: q }))}
          />
          <List
            heading="Artifacts to ask for"
            items={content.artifactChecklist.map((a) => ({
              key: a.kind,
              text: `${a.kind.replace(/_/g, " ")}: ${a.why}`,
            }))}
          />
          {canEdit && brief.reviewStatus === "unreviewed" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.reviewBrief(workshop.id, brief.id);
                  await load();
                })
              }
            >
              Mark reviewed
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
