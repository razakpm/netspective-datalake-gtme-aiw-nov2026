"use client";
import { useCallback, useEffect, useState } from "react";
import type { EffortEntry, WorkshopsApi } from "../../../lib/workshops-api.js";
import { useWork } from "./use-work.js";

// Delivery effort (feature 007, spec FR-033). A correction is a new entry; the latest one counts.
export function EffortPanel({
  workshopId,
  api,
  canEdit,
}: {
  workshopId: string;
  api: WorkshopsApi;
  canEdit: boolean;
}) {
  const [current, setCurrent] = useState<EffortEntry | null>(null);
  const [prep, setPrep] = useState("");
  const [session, setSession] = useState("");
  const [people, setPeople] = useState("");
  const { error, busy, run } = useWork();
  const load = useCallback(
    () => run(async () => setCurrent((await api.effort(workshopId)).current)),
    [api, workshopId, run],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    limits: { min: number; max: number; step: number },
  ) => (
    <label>
      {label}
      <input
        type="number"
        required
        value={value}
        {...limits}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <section aria-label="Delivery effort">
      <h2>Delivery effort</h2>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        {current
          ? `${current.prepHours} preparation hours, ${current.sessionHours} session hours, ${current.people} people.`
          : "Nothing recorded yet."}
      </p>
      {canEdit ? (
        <form
          aria-label="Record effort"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.recordEffort(workshopId, {
                prepHours: Number(prep),
                sessionHours: Number(session),
                people: Number(people),
              });
              await load();
            });
          }}
        >
          {field("Preparation hours", prep, setPrep, { min: 0, max: 80, step: 0.25 })}
          {field("Session hours", session, setSession, { min: 0, max: 24, step: 0.25 })}
          {field("People", people, setPeople, { min: 1, max: 20, step: 1 })}
          <button type="submit" disabled={busy}>
            Record effort
          </button>
        </form>
      ) : null}
    </section>
  );
}
