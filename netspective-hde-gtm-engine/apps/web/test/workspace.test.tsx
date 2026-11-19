// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WorkspaceView,
  type WorkspaceApi,
} from "../src/app/accounts/[id]/workspace/workspace-view.js";
import type { Hypothesis, HypothesisSummary } from "../src/lib/hypotheses-api.js";
import { ResearchApiError, type RunView } from "../src/lib/research-api.js";

afterEach(cleanup);

const summary = (over: Partial<HypothesisSummary> = {}): HypothesisSummary => ({
  id: "h1",
  accountId: "a1",
  acceptance: "accepted",
  origin: "analyst",
  statement: "Sender onboarding may be slow.",
  category: "onboarding_friction",
  status: "untested",
  effectiveStatus: "untested",
  confidence: { band: "low", explanation: "One note." },
  flaggedForReview: false,
  flagReason: null,
  notForPrioritisation: false,
  label: "Hypothesis",
  ...over,
});
const detail = (): Hypothesis => ({
  ...summary(),
  supporting: [
    {
      signalId: "s1",
      observation: "Senders report delays.",
      evidenceStatus: "ai_extracted",
      reviewStatus: "pending",
      isCurrent: true,
    },
  ],
  contradictory: [],
  buyerConfirmedFacts: [],
  assumptions: [],
  relevance: { icp: [], capability: [], offer: [] },
  statusHistory: [],
  definitions: { low: "Little evidence.", medium: "Some evidence.", high: "Strong evidence." },
});
const run = (over: Partial<RunView> = {}): RunView => ({
  id: "r1",
  accountId: "a1",
  state: "completed",
  trigger: "manual",
  stopReason: null,
  icpExcluded: false,
  budget: { maxSources: 10, maxCost: "2.00" },
  totals: {
    sourcesRead: 2,
    cost: "0.12",
    retries: 0,
    injectionFlags: 0,
    droppedFindings: { uncited: 0, unsupported: 0, protectedTopic: 0, taxonomy: 0 },
  },
  attention: null,
  createdAt: "2026-11-19T10:00:00Z",
  finishedAt: null,
  ...over,
});

function makeApi(over: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    account: async () => ({
      name: "Northvale HIE",
      orgType: "health_information_exchange",
      fit: {},
      domains: [],
    }),
    signals: async () => ({ items: [] }),
    summary: async () => ({
      accountId: "a1",
      runId: "r1",
      label: "AI-generated, advisory",
      facts: [],
      inferences: [],
      unknowns: [{ topic: "budget", statement: "Budget is not known." }],
      contradictions: [],
      sources: [],
    }),
    runs: async () => ({ items: [run()] }),
    startRun: vi.fn(async () => run({ state: "queued" })),
    cancelRun: vi.fn(async () => run()),
    acknowledge: vi.fn(async () => run()),
    hypotheses: {
      list: vi.fn(async (_id: string, acceptance: string) => ({
        items: acceptance === "accepted" ? [summary()] : [],
      })),
      get: vi.fn(async () => detail()),
      accept: vi.fn(),
      dismiss: vi.fn(),
      changeStatus: vi.fn(),
      addAssumption: vi.fn(),
    } as never,
    ...over,
  };
}

describe("workspace", () => {
  it("shows ICP as not assessed, unknowns and runs with cost", async () => {
    render(
      <WorkspaceView
        accountId="a1"
        permissions={["research.read", "hypotheses.read"]}
        api={makeApi()}
      />,
    );
    expect(await screen.findByText(/not assessed yet/)).toBeTruthy();
    expect(screen.getByText("Budget is not known.")).toBeTruthy();
    expect(screen.getByText(/cost 0.12 of 2.00/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start run" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Change status" })).toBeNull();
  });
  it("shows controls only with the permission", async () => {
    render(
      <WorkspaceView
        accountId="a1"
        permissions={["research.read", "research.run", "hypotheses.read", "hypotheses.review"]}
        api={makeApi()}
      />,
    );
    expect(await screen.findByRole("button", { name: "Start run" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Sender onboarding may be slow." }));
    expect(await screen.findByRole("form", { name: "Change status" })).toBeTruthy();
    expect(screen.getByText("Senders report delays.")).toBeTruthy();
  });
  it("explains a refused status change in plain words", async () => {
    const api = makeApi();
    (api.hypotheses.changeStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ResearchApiError(422, ["validated_needs_buyer_confirmed_evidence"]),
    );
    render(
      <WorkspaceView
        accountId="a1"
        permissions={["hypotheses.read", "hypotheses.review"]}
        api={api}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sender onboarding may be slow." }));
    fireEvent.change(await screen.findByLabelText("Note"), { target: { value: "Looks right" } });
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/buyer-confirmed/));
  });
  it("shows the excluded banner", async () => {
    const api = makeApi({ runs: async () => ({ items: [run({ icpExcluded: true })] }) });
    render(<WorkspaceView accountId="a1" permissions={["research.read"]} api={api} />);
    expect(await screen.findByText(/excluded or on hold/)).toBeTruthy();
  });
});
