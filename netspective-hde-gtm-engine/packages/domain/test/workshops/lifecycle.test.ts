import { describe, expect, it } from "vitest";
import {
  checkWorkshopTransition,
  isFinalWorkshopState,
  isOpenWorkshopState,
  WORKSHOP_ACTIONS,
  WORKSHOP_STATES,
  type WorkshopAction,
  type WorkshopState,
} from "../../src/index.js";

// Feature 007 task T022: every (state, action) pair of the pure workshop lifecycle (spec FR-002, FR-003).
const ALLOWED: Partial<Record<WorkshopState, Partial<Record<WorkshopAction, WorkshopState>>>> = {
  requested: { book: "booked", cancel: "cancelled" },
  booked: { hold: "held", no_show: "no_show", cancel: "cancelled", reschedule: "booked" },
  held: { record_findings: "findings_recorded" },
  findings_recorded: { close: "closed" },
};
const full = { note: "a reason", scheduledAt: "2026-12-01T10:00:00.000Z" };

describe("workshop lifecycle", () => {
  it("has the seven states and the seven actions", () => {
    expect([...WORKSHOP_STATES]).toEqual([
      "requested",
      "booked",
      "held",
      "findings_recorded",
      "closed",
      "cancelled",
      "no_show",
    ]);
    expect([...WORKSHOP_ACTIONS].sort()).toEqual(
      ["book", "cancel", "close", "hold", "no_show", "record_findings", "reschedule"].sort(),
    );
  });

  const pairs = WORKSHOP_STATES.flatMap((from) =>
    WORKSHOP_ACTIONS.map((action) => [from, action] as const),
  );
  it.each(pairs)("%s + %s", (from, action) => {
    const to = ALLOWED[from]?.[action];
    expect(checkWorkshopTransition(from, action, full)).toEqual(
      to ? { ok: true, to } : { ok: false, code: "invalid_transition" },
    );
  });

  it("needs a note to cancel, to record a no-show, to close and to reschedule", () => {
    for (const [from, action] of [
      ["requested", "cancel"],
      ["booked", "cancel"],
      ["booked", "no_show"],
      ["findings_recorded", "close"],
      ["booked", "reschedule"],
    ] as const) {
      for (const note of [undefined, "", "  ", "ab"]) {
        expect(
          checkWorkshopTransition(from, action, { ...full, note }),
          `${from} ${action}`,
        ).toEqual({ ok: false, code: "note_required" });
      }
    }
  });

  it("needs a time to book and to reschedule", () => {
    for (const [from, action] of [
      ["requested", "book"],
      ["booked", "reschedule"],
    ] as const) {
      expect(checkWorkshopTransition(from, action, { note: "a reason" })).toEqual({
        ok: false,
        code: "time_required",
      });
    }
  });

  it("needs no note to book, hold or record findings", () => {
    expect(checkWorkshopTransition("requested", "book", { scheduledAt: full.scheduledAt }).ok).toBe(
      true,
    );
    expect(checkWorkshopTransition("booked", "hold").ok).toBe(true);
    expect(checkWorkshopTransition("held", "record_findings").ok).toBe(true);
  });

  it("knows which states are open and which are final", () => {
    expect(WORKSHOP_STATES.filter(isOpenWorkshopState)).toEqual([
      "requested",
      "booked",
      "held",
      "findings_recorded",
    ]);
    expect(WORKSHOP_STATES.filter(isFinalWorkshopState)).toEqual([
      "closed",
      "cancelled",
      "no_show",
    ]);
  });
});
