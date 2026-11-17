// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsView } from "../src/app/admin/jobs/jobs-view.js";
import type { JobsApi, JobView } from "../src/lib/jobs-api.js";

afterEach(cleanup);

const failedJob: JobView = {
  id: "j1",
  queue: "test.always-fail",
  idempotencyKey: "k",
  state: "failed",
  attempts: 5,
  maxAttempts: 5,
  nextRunAt: "2026-11-13T00:00:00.000Z",
  scheduledBy: "t",
  lastError: { code: "Error", message: "synthetic failure", stack_hash: "abc" },
  correlationId: null,
  createdAt: "2026-11-13T00:00:00.000Z",
  finishedAt: "2026-11-13T00:05:00.000Z",
};

describe("jobs admin view", () => {
  it("shows a failed job with its redacted error and the queue depth", async () => {
    const api: JobsApi = {
      list: vi.fn(async () => ({ items: [failedJob] })),
      queues: vi.fn(async () => ({
        items: [{ queue: "test.always-fail", queued: 1, running: 0, failed: 1, depthCap: 1000 }],
      })),
    };
    render(<JobsView api={api} />);
    expect(await screen.findByText(/synthetic failure/)).toBeTruthy();
    expect(screen.getByText(/after 5 attempts/)).toBeTruthy();
    expect(screen.getByText(/1 of 1000 in use/)).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith({ state: "failed" });
  });

  it("says so when nothing has failed", async () => {
    render(
      <JobsView api={{ list: async () => ({ items: [] }), queues: async () => ({ items: [] }) }} />,
    );
    expect(await screen.findByText(/no failed jobs/i)).toBeTruthy();
  });

  it("shows a plain message when loading fails", async () => {
    render(
      <JobsView
        api={{
          list: async () => Promise.reject(new Error("db exploded")),
          queues: async () => ({ items: [] }),
        }}
      />,
    );
    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).not.toContain("db exploded");
  });
});
