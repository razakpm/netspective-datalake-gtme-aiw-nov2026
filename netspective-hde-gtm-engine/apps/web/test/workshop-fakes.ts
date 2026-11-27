import { vi } from "vitest";
import type { Workshop, WorkshopsApi, WorkshopSummary } from "../src/lib/workshops-api.js";

// Synthetic data and an injected client for the workshop screen tests.
export const summary = (over: Partial<WorkshopSummary> = {}): WorkshopSummary => ({
  id: "w1",
  offerId: "offer-1",
  offerKey: "sender-onboarding-friction-map",
  state: "requested",
  accountId: "a1",
  accountName: "Northvale HIE",
  contactId: "c1",
  scheduledAt: null,
  durationMinutes: 45,
  createdAt: "2026-11-27T10:00:00.000Z",
  ...over,
});

export const workshop = (over: Partial<Workshop> = {}): Workshop => ({
  ...summary(),
  requestId: "q1",
  lockNo: 1,
  bookingRoute: null,
  intake: { organisationName: "Northvale HIE", attendingRoles: ["Integration lead"] },
  history: [
    {
      fromState: null,
      toState: "requested",
      note: null,
      scheduledFrom: null,
      scheduledTo: null,
      changedBy: "operator-1",
      changedAt: "2026-11-27T10:00:00.000Z",
    },
  ],
  participants: [],
  notices: [],
  capacity: { state: "room", periodKind: "week", limit: 3, used: 1 },
  ...over,
});

/** Every call resolves to something harmless; a test replaces what it looks at. */
export function fakeWorkshopsApi(over: Partial<WorkshopsApi> = {}): WorkshopsApi {
  const done = () => vi.fn().mockResolvedValue({});
  return {
    list: vi.fn().mockResolvedValue({ items: [] }),
    convert: done(),
    get: vi.fn().mockResolvedValue(workshop()),
    transition: vi.fn().mockResolvedValue(workshop()),
    addParticipant: done(),
    removeParticipant: done(),
    artifacts: vi.fn().mockResolvedValue({ checklist: [], items: [] }),
    recordArtifact: done(),
    decideArtifact: done(),
    brief: vi.fn().mockResolvedValue({ latest: null, earlier: [] }),
    generateBrief: done(),
    reviewBrief: done(),
    findings: vi.fn().mockResolvedValue({ current: null, versions: [], shortfalls: [] }),
    saveFindings: done(),
    finalise: done(),
    suggest: done(),
    output: vi.fn().mockResolvedValue({ latest: null, revisions: [], shares: [] }),
    generateOutput: done(),
    editOutput: done(),
    approveOutput: done(),
    shareOutput: done(),
    effortSummary: vi.fn().mockResolvedValue({ items: [] }),
    effort: vi.fn().mockResolvedValue({ current: null, history: [] }),
    recordEffort: done(),
    ...over,
  };
}
