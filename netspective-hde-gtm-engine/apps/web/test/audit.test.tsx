// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditViewer } from "../src/app/admin/audit/audit-viewer.js";
import { visibleNavItems } from "../src/components/nav.js";
import type { AuditApi, AuditEventView } from "../src/lib/audit-api.js";

afterEach(cleanup);

const event = (over: Partial<AuditEventView> = {}): AuditEventView => ({
  id: "e1",
  occurredAt: "2026-11-13T00:00:00.000Z",
  actorId: "u1",
  actorType: "human",
  action: "user.invited",
  entityType: "user",
  entityId: "x",
  outcome: "success",
  correlationId: "corr-12345",
  ...over,
});

describe("audit viewer", () => {
  it("lists events and applies filters", async () => {
    const list = vi.fn(async (filters: object) => ({
      items:
        "entityType" in filters ? [event({ id: "e2", action: "user.deactivated" })] : [event()],
      nextCursor: null,
    }));
    const api: AuditApi = { list };
    const ui = userEvent.setup();
    render(<AuditViewer api={api} />);
    expect(await screen.findByText("user.invited")).toBeTruthy();

    await ui.type(screen.getByLabelText("Entity type"), "user");
    await ui.click(screen.getByRole("button", { name: /apply filters/i }));
    expect(await screen.findByText("user.deactivated")).toBeTruthy();
    expect(list).toHaveBeenLastCalledWith({ entityType: "user" });
  });

  it("has no edit or delete controls", async () => {
    render(<AuditViewer api={{ list: async () => ({ items: [event()], nextCursor: null }) }} />);
    await screen.findByText("user.invited");
    const names = screen.getAllByRole("button").map((b) => b.textContent?.toLowerCase() ?? "");
    expect(names).toEqual(["apply filters"]);
    expect(screen.queryByRole("link", { name: /delete|edit/i })).toBeNull();
  });

  it("shows a plain message when loading fails", async () => {
    render(<AuditViewer api={{ list: async () => Promise.reject(new Error("db exploded")) }} />);
    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert.textContent).not.toContain("db exploded");
    await waitFor(() => expect(alert.textContent).toMatch(/could not load/i));
  });

  it("is reachable only with audit.read", () => {
    expect(visibleNavItems(["jobs.read"]).map((i) => i.label)).not.toContain("Audit");
    expect(visibleNavItems(["audit.read"]).map((i) => i.label)).toContain("Audit");
  });
});
