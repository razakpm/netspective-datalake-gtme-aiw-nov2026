"use client";
import { useCallback, useEffect, useState } from "react";
import { PhiWarning } from "../../../components/phi-warning.js";
import {
  browserWorkshopsApi,
  OFFER_TEXT,
  STATE_TEXT,
  type Workshop,
  type WorkshopAction,
  type WorkshopsApi,
} from "../../../lib/workshops-api.js";
import { ArtifactsPanel } from "./artifacts-panel.js";
import { BriefPanel } from "./brief-panel.js";
import { EffortPanel } from "./effort-panel.js";
import { FindingsOffer1 } from "./findings-offer1.js";
import { FindingsOffer6 } from "./findings-offer6.js";
import { OutputPanel } from "./output-panel.js";
import { useWork } from "./use-work.js";

// The workshop workspace (feature 007, spec FR-037): the intake, participants, booking and state, the
// brief, artifacts, findings, the buyer page and effort. Controls appear only for holders of the
// permission; the API enforces every permission. Nothing here sends a message or invites anyone.

const NOTICE_TEXT: Record<string, string> = {
  account_suppressed: "This account is suppressed. Do not contact them.",
  contact_suppressed: "This contact is suppressed. Do not contact them.",
  consent_withdrawn: "Consent to be contacted has been withdrawn.",
  calendar_needs_attention: "A calendar event needs attention. Check it and clear it by hand.",
};
const ACTION_TEXT: Record<WorkshopAction, string> = {
  book: "Book",
  reschedule: "Reschedule",
  hold: "Mark held",
  no_show: "Record no-show",
  cancel: "Cancel workshop",
  close: "Close workshop",
};
const ACTIONS: Record<Workshop["state"], WorkshopAction[]> = {
  requested: ["book", "cancel"],
  booked: ["hold", "reschedule", "no_show", "cancel"],
  held: [],
  findings_recorded: ["close"],
  closed: [],
  cancelled: [],
  no_show: [],
};
const NEEDS_NOTE: ReadonlySet<WorkshopAction> = new Set([
  "reschedule",
  "no_show",
  "cancel",
  "close",
]);

const words = (key: string) => key.replace(/([A-Z])/g, " $1").toLowerCase();
const show = (value: unknown): string =>
  Array.isArray(value)
    ? value.map(show).join(", ")
    : typeof value === "object" && value !== null
      ? Object.values(value).map(show).join(" · ")
      : String(value);

function Booking({
  workshop,
  api,
  onMoved,
}: {
  workshop: Workshop;
  api: WorkshopsApi;
  onMoved: () => Promise<void>;
}) {
  const [when, setWhen] = useState("");
  const [via, setVia] = useState<"manual" | "calendar">("manual");
  const [note, setNote] = useState("");
  const { error, busy, run } = useWork();
  const actions = ACTIONS[workshop.state];
  if (actions.length === 0) return null;
  const schedules = actions.includes("book") || actions.includes("reschedule");
  const move = (action: WorkshopAction) =>
    run(async () => {
      const timed = action === "book" || action === "reschedule";
      await api.transition(workshop.id, {
        action,
        lockNo: workshop.lockNo,
        ...(timed ? { scheduledAt: new Date(when).toISOString(), via } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setNote("");
      await onMoved();
    });
  const ready = (action: WorkshopAction) =>
    !(NEEDS_NOTE.has(action) && note.trim().length < 3) &&
    !((action === "book" || action === "reschedule") && !when);

  return (
    <form aria-label="Booking and state" onSubmit={(e) => e.preventDefault()}>
      {error ? <p role="alert">{error}</p> : null}
      {schedules ? (
        <>
          <label>
            Date and time
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <label>
            Book through
            <select value={via} onChange={(e) => setVia(e.target.value as "manual" | "calendar")}>
              <option value="manual">By hand</option>
              <option value="calendar">The calendar (no invitation is sent)</option>
            </select>
          </label>
        </>
      ) : null}
      {actions.some((a) => NEEDS_NOTE.has(a)) ? (
        <>
          <label>
            Reason (needed to reschedule, cancel, record a no-show or close)
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </label>
          <PhiWarning value={note} />
        </>
      ) : null}
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          disabled={busy || !ready(action)}
          onClick={() => void move(action)}
        >
          {ACTION_TEXT[action]}
        </button>
      ))}
    </form>
  );
}

function Participants({
  workshop,
  api,
  canEdit,
  onChanged,
}: {
  workshop: Workshop;
  api: WorkshopsApi;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const [side, setSide] = useState<"buyer" | "delivery">("buyer");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const { error, busy, run } = useWork();
  return (
    <section aria-label="Participants">
      <h2>Participants</h2>
      {error ? <p role="alert">{error}</p> : null}
      <ul>
        {workshop.participants
          .filter((p) => p.removedAt === null)
          .map((p) => (
            <li key={p.id}>
              {p.displayName}
              {p.roleTitle ? `, ${p.roleTitle}` : ""} ({p.side})
              {canEdit ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.removeParticipant(workshop.id, p.id);
                      await onChanged();
                    })
                  }
                >
                  Remove {p.displayName}
                </button>
              ) : null}
            </li>
          ))}
      </ul>
      {canEdit ? (
        <form
          aria-label="Add a participant"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api.addParticipant(workshop.id, {
                side,
                displayName: name,
                ...(role ? { roleTitle: role } : {}),
              });
              setName("");
              setRole("");
              await onChanged();
            });
          }}
        >
          <label>
            Side
            <select value={side} onChange={(e) => setSide(e.target.value as "buyer" | "delivery")}>
              <option value="buyer">Buyer</option>
              <option value="delivery">Delivery</option>
            </select>
          </label>
          <label>
            Name (no email or phone number)
            <input
              value={name}
              minLength={2}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Role
            <input value={role} maxLength={120} onChange={(e) => setRole(e.target.value)} />
          </label>
          <PhiWarning value={`${name} ${role}`} />
          <button type="submit" disabled={busy}>
            Add participant
          </button>
        </form>
      ) : null}
    </section>
  );
}

export function WorkshopWorkspace({
  id,
  permissions,
  api = browserWorkshopsApi,
}: {
  id: string;
  permissions: readonly string[];
  api?: WorkshopsApi;
}) {
  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  /** Bumped when the findings change, so the page panel reads them again. */
  const [findingsVersion, setFindingsVersion] = useState(0);
  const { error, run } = useWork();
  const load = useCallback(() => run(async () => setWorkshop(await api.get(id))), [api, id, run]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!workshop) {
    return (
      <main>
        <h1>Workshop</h1>
        {error ? <p role="alert">{error}</p> : <p>Loading…</p>}
      </main>
    );
  }
  const can = (p: string) => permissions.includes(p);
  const canEdit = can("workshops.edit");
  const { capacity } = workshop;
  const findingsOpen = ["held", "findings_recorded", "closed"].includes(workshop.state);
  const Findings = workshop.offerId === "offer-6" ? FindingsOffer6 : FindingsOffer1;

  return (
    <main>
      <h1>
        {workshop.accountName} · {OFFER_TEXT[workshop.offerKey] ?? workshop.offerKey}
      </h1>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        <strong>{STATE_TEXT[workshop.state]}</strong> · {workshop.durationMinutes} minutes
        {workshop.scheduledAt
          ? ` · ${new Date(workshop.scheduledAt).toLocaleString()} (${workshop.bookingRoute === "calendar" ? "calendar" : "booked by hand"})`
          : ""}
      </p>
      {workshop.notices.map((notice) => (
        <p role="note" key={notice}>
          {NOTICE_TEXT[notice] ?? notice}
        </p>
      ))}

      <section aria-label="Capacity">
        <h2>Capacity</h2>
        {capacity.state === "no_limit_set" ? (
          <p>No limit is set for this offer.</p>
        ) : (
          <p>
            {capacity.used} of {capacity.limit} sessions used this {capacity.periodKind}.
          </p>
        )}
        {capacity.state === "exhausted" && workshop.state === "requested" ? (
          <p>
            The offer is full for this period. Choose another date, or add the account to the
            wait-list from its{" "}
            <a href={`/accounts/${encodeURIComponent(workshop.accountId)}/workspace`}>
              account workspace
            </a>
            .
          </p>
        ) : null}
      </section>
      {canEdit ? <Booking workshop={workshop} api={api} onMoved={load} /> : null}

      <section aria-label="Intake">
        <h2>Intake (non-PHI)</h2>
        <dl>
          {Object.entries(workshop.intake).map(([key, value]) => (
            <div key={key}>
              <dt>{words(key)}</dt>
              <dd>{show(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Participants workshop={workshop} api={api} canEdit={canEdit} onChanged={load} />
      <BriefPanel workshop={workshop} api={api} canEdit={canEdit} />
      <ArtifactsPanel
        workshopId={workshop.id}
        api={api}
        canEdit={canEdit}
        canReview={can("quarantine.review")}
      />
      {findingsOpen ? (
        <>
          <Findings
            workshopId={workshop.id}
            api={api}
            canEdit={canEdit}
            onChanged={async () => {
              setFindingsVersion((v) => v + 1);
              await load();
            }}
          />
          <OutputPanel
            key={findingsVersion}
            workshopId={workshop.id}
            api={api}
            canEdit={canEdit}
            canApprove={can("workshops.output.approve")}
          />
        </>
      ) : (
        <p>Findings can be recorded once the session has been held.</p>
      )}
      <EffortPanel workshopId={workshop.id} api={api} canEdit={canEdit} />

      <section aria-label="History">
        <h2>History</h2>
        <ol>
          {workshop.history.map((h) => (
            <li key={`${h.changedAt}-${h.toState}`}>
              {STATE_TEXT[h.toState as Workshop["state"]] ?? h.toState} ·{" "}
              {new Date(h.changedAt).toLocaleString()}
              {h.scheduledFrom && h.scheduledTo
                ? ` · moved from ${new Date(h.scheduledFrom).toLocaleString()} to ${new Date(h.scheduledTo).toLocaleString()}`
                : ""}
              {h.note ? ` · ${h.note}` : ""}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
