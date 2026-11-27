// The workshop lifecycle (feature 007, spec FR-002 and FR-003, research R-02). A pure state machine: a
// person asks for a move and these rules say whether it is allowed. No model and no job decides a state.

export const WORKSHOP_STATES = [
  "requested",
  "booked",
  "held",
  "findings_recorded",
  "closed",
  "cancelled",
  "no_show",
] as const;
export type WorkshopState = (typeof WORKSHOP_STATES)[number];

/** `record_findings` is made by finalising the findings; the others are asked for directly. */
export const WORKSHOP_ACTIONS = [
  "book",
  "reschedule",
  "hold",
  "no_show",
  "cancel",
  "close",
  "record_findings",
] as const;
export type WorkshopAction = (typeof WORKSHOP_ACTIONS)[number];

const MOVES: Readonly<Record<WorkshopState, Partial<Record<WorkshopAction, WorkshopState>>>> = {
  requested: { book: "booked", cancel: "cancelled" },
  booked: { reschedule: "booked", hold: "held", no_show: "no_show", cancel: "cancelled" },
  held: { record_findings: "findings_recorded" },
  findings_recorded: { close: "closed" },
  closed: {},
  cancelled: {},
  no_show: {},
};

const NEEDS_NOTE: ReadonlySet<WorkshopAction> = new Set([
  "cancel",
  "no_show",
  "close",
  "reschedule",
]);
const NEEDS_TIME: ReadonlySet<WorkshopAction> = new Set(["book", "reschedule"]);
export const WORKSHOP_NOTE_MIN = 3;

export type TransitionCheck =
  | { ok: true; to: WorkshopState }
  | { ok: false; code: "invalid_transition" | "note_required" | "time_required" };

export function checkWorkshopTransition(
  from: WorkshopState,
  action: WorkshopAction,
  given: { note?: string | undefined; scheduledAt?: string | undefined } = {},
): TransitionCheck {
  const to = MOVES[from][action];
  if (!to) return { ok: false, code: "invalid_transition" };
  if (NEEDS_TIME.has(action) && !given.scheduledAt) return { ok: false, code: "time_required" };
  if (NEEDS_NOTE.has(action) && (given.note?.trim().length ?? 0) < WORKSHOP_NOTE_MIN) {
    return { ok: false, code: "note_required" };
  }
  return { ok: true, to };
}

/** No move leaves a final state. */
export const isFinalWorkshopState = (state: WorkshopState): boolean =>
  Object.keys(MOVES[state]).length === 0;
/** A request has at most one open workshop. */
export const isOpenWorkshopState = (state: WorkshopState): boolean => !isFinalWorkshopState(state);
