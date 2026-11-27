"use client";
import { useCallback, useEffect, useState } from "react";
import { PhiWarning } from "../../../components/phi-warning.js";
import type { Artifact, ArtifactList, WorkshopsApi } from "../../../lib/workshops-api.js";
import { useWork } from "./use-work.js";

// Non-PHI artifacts (feature 007, spec FR-014 to FR-017). A reference, or a text file the server checks
// before keeping. A file that looks like patient data is held for a reviewer, and the screen says so.

const STATUS = { received: "received", held: "held for review", not_received: "not received" };

export function ArtifactsPanel({
  workshopId,
  api,
  canEdit,
  canReview,
}: {
  workshopId: string;
  api: WorkshopsApi;
  canEdit: boolean;
  canReview: boolean;
}) {
  const [data, setData] = useState<ArtifactList | null>(null);
  const [kind, setKind] = useState("");
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [suppliedBy, setSuppliedBy] = useState("");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [held, setHeld] = useState(false);
  const { error, busy, run } = useWork();
  const load = useCallback(
    () => run(async () => setData(await api.artifacts(workshopId))),
    [api, workshopId, run],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const chosen = kind || data?.checklist[0]?.kind || "";

  const decide = (a: Artifact, decision: "release" | "discard") =>
    run(async () => {
      await api.decideArtifact(a.id, { decision, reason });
      setReason("");
      await load();
    });

  return (
    <section aria-label="Artifacts">
      <h2>Artifacts (non-PHI only)</h2>
      {error ? <p role="alert">{error}</p> : null}
      {held ? (
        <p role="status">
          The file is held for review because it looks as if it may contain patient data or a
          credential. It was not kept or sent anywhere, and the operator has been alerted.
        </p>
      ) : null}
      <ul aria-label="Checklist">
        {data?.checklist.map((item) => (
          <li key={item.kind}>
            {item.label}: {STATUS[item.status]}
          </li>
        ))}
      </ul>
      <ul aria-label="Recorded artifacts">
        {data?.items.map((a) => (
          <li key={a.id}>
            {a.title} ({a.kind.replace(/_/g, " ")}) · {a.state}
            {a.reference ? ` · ${a.reference}` : ""}
            {a.suppliedBy ? ` · from ${a.suppliedBy}` : ""}
            {a.hasContent && (a.state === "received" || a.state === "released") ? (
              <>
                {" "}
                <a href={`/api/v1/workshop-artifacts/${encodeURIComponent(a.id)}/content`}>
                  Download {a.title}
                </a>
              </>
            ) : null}
            {a.state === "held" && canReview ? (
              <>
                <label>
                  Reason for the decision on {a.title}
                  <input
                    value={reason}
                    maxLength={300}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                {(["release", "discard"] as const).map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void decide(a, decision)}
                  >
                    {decision === "release" ? "Release" : "Discard"} {a.title}
                  </button>
                ))}
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          aria-label="Record an artifact"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void run(async () => {
              setHeld(false);
              const made = await api.recordArtifact(workshopId, {
                kind: chosen,
                title,
                ...(reference ? { reference } : {}),
                ...(suppliedBy ? { suppliedBy } : {}),
                ...(file ? { content: file.text, fileName: file.name } : {}),
              });
              setHeld(made.state === "held");
              setTitle("");
              setReference("");
              setFile(null);
              form.reset();
              await load();
            });
          }}
        >
          <p>
            Only text files (txt, md, csv, json, log) can be kept. Record other files, such as a PDF
            or an image, by reference.
          </p>
          <label>
            Kind
            <select value={chosen} onChange={(e) => setKind(e.target.value)}>
              {data?.checklist.map((item) => (
                <option key={item.kind} value={item.kind}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input
              value={title}
              minLength={2}
              maxLength={200}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Reference (where it is)
            <input
              value={reference}
              maxLength={500}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label>
            Supplied by (a role or team)
            <input
              value={suppliedBy}
              maxLength={120}
              onChange={(e) => setSuppliedBy(e.target.value)}
            />
          </label>
          <label>
            Text file
            <input
              type="file"
              accept=".txt,.md,.csv,.json,.log"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (!picked) return setFile(null);
                void picked.text().then((text) => setFile({ name: picked.name, text }));
              }}
            />
          </label>
          <PhiWarning value={`${title} ${reference} ${suppliedBy} ${file?.text ?? ""}`} />
          <button type="submit" disabled={busy || (!reference && !file)}>
            Record artifact
          </button>
        </form>
      ) : null}
    </section>
  );
}
