// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ForbiddenNotice from "../src/app/admin/users/forbidden.js";
import { UsersAdmin } from "../src/app/admin/users/users-admin.js";
import { ApiError, describeApiError, type UsersApi, type UserView } from "../src/lib/users-api.js";

afterEach(cleanup);

const user = (over: Partial<UserView> = {}): UserView => ({
  id: "018f0000-0000-7000-8000-000000000001",
  email: "a@example.org",
  status: "active",
  roles: ["administrator"],
  invitationExpiresAt: null,
  lastSignInAt: null,
  createdAt: "2026-11-13T00:00:00.000Z",
  ...over,
});

function fakeApi(over: Partial<UsersApi> = {}): UsersApi {
  return {
    list: vi.fn(async () => ({ items: [user()], nextCursor: null })),
    invite: vi.fn(async () =>
      user({
        id: "018f0000-0000-7000-8000-000000000002",
        email: "new@example.org",
        status: "invited",
        roles: ["gtm_operator"],
      }),
    ),
    setRoles: vi.fn(async (_id, roles) => user({ roles })),
    deactivate: vi.fn(async () => user({ status: "deactivated" })),
    reactivate: vi.fn(async () => user({ status: "active" })),
    ...over,
  };
}

describe("describeApiError", () => {
  it("maps the last-administrator conflict to a plain message", () => {
    expect(describeApiError(new ApiError(409, "urn:gtm:problem:last-administrator"))).toMatch(
      /last administrator/i,
    );
  });
  it("never exposes technical detail", () => {
    const text = describeApiError(new ApiError(500, "about:blank", "stack trace at line 5"));
    expect(text).not.toContain("stack");
    expect(describeApiError(new Error("boom"))).not.toContain("boom");
  });
});

describe("administrator users page", () => {
  it("lists users with status and roles", async () => {
    render(<UsersAdmin api={fakeApi()} />);
    expect(await screen.findByText("a@example.org")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
  });

  it("invites a user with roles and sends an Idempotency-Key", async () => {
    const api = fakeApi();
    const ui = userEvent.setup();
    render(<UsersAdmin api={api} />);
    await screen.findByText("a@example.org");
    await ui.type(screen.getByLabelText(/email/i), "new@example.org");
    await ui.click(
      within(screen.getByRole("form", { name: /invite a user/i })).getByLabelText("GTM operator"),
    );
    await ui.click(screen.getByRole("button", { name: /invite/i }));
    await waitFor(() => expect(api.invite).toHaveBeenCalledTimes(1));
    const [body, key] = (api.invite as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(body).toEqual({ email: "new@example.org", roles: ["gtm_operator"] });
    expect(typeof key).toBe("string");
    expect((key as string).length).toBeGreaterThanOrEqual(8);
    expect(await screen.findByText("new@example.org")).toBeTruthy();
  });

  it("assigns roles to an existing user", async () => {
    const api = fakeApi({
      list: vi.fn(async () => ({
        items: [user({ roles: [], status: "active" })],
        nextCursor: null,
      })),
    });
    const ui = userEvent.setup();
    render(<UsersAdmin api={api} />);
    await screen.findByText("a@example.org");
    await ui.click(within(screen.getByRole("listitem")).getByLabelText("Research analyst"));
    await ui.click(screen.getByRole("button", { name: /save roles/i }));
    await waitFor(() => expect(api.setRoles).toHaveBeenCalled());
    expect((api.setRoles as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual([
      "research_analyst",
    ]);
  });

  it("deactivates and reactivates", async () => {
    const api = fakeApi();
    const ui = userEvent.setup();
    render(<UsersAdmin api={api} />);
    await screen.findByText("a@example.org");
    await ui.click(screen.getByRole("button", { name: /deactivate/i }));
    await waitFor(() => expect(api.deactivate).toHaveBeenCalled());
    await ui.click(await screen.findByRole("button", { name: /reactivate/i }));
    await waitFor(() => expect(api.reactivate).toHaveBeenCalled());
  });

  it("shows a friendly message for the last-administrator conflict", async () => {
    const api = fakeApi({
      deactivate: vi.fn(async () => {
        throw new ApiError(409, "urn:gtm:problem:last-administrator", "internal detail");
      }),
    });
    const ui = userEvent.setup();
    render(<UsersAdmin api={api} />);
    await screen.findByText("a@example.org");
    await ui.click(screen.getByRole("button", { name: /deactivate/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/last administrator/i);
    expect(alert.textContent).not.toContain("internal detail");
  });

  it("renders a forbidden notice for a direct visit without users.manage", () => {
    render(<ForbiddenNotice />);
    expect(screen.getByRole("heading", { name: /forbidden/i })).toBeTruthy();
  });
});
