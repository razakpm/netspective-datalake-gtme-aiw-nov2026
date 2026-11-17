// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Nav, visibleNavItems } from "../src/components/nav.js";
import NoAccessPage from "../src/app/no-access/page.js";

afterEach(cleanup);

describe("permission-gated navigation", () => {
  it("shows nothing for a user with no permissions", () => {
    expect(visibleNavItems([])).toEqual([]);
    const { container } = render(<Nav permissions={[]} />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("shows only the areas the permissions allow", () => {
    const labels = visibleNavItems(["jobs.read", "webhooks.read"]).map((i) => i.label);
    expect(labels).toEqual(["Jobs", "Webhooks"]);
    render(<Nav permissions={["jobs.read", "webhooks.read"]} />);
    expect(screen.getByRole("link", { name: "Jobs" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
  });

  it("shows user administration only with users.manage", () => {
    render(<Nav permissions={["users.manage"]} />);
    expect(screen.getByRole("link", { name: "Users" }).getAttribute("href")).toBe("/admin/users");
  });

  it("ignores unknown permission strings", () => {
    expect(visibleNavItems(["bogus.permission"])).toEqual([]);
  });
});

describe("no access page", () => {
  it("tells a zero-role user clearly that no access is assigned", () => {
    render(<NoAccessPage />);
    expect(screen.getByRole("heading", { name: /no access assigned/i })).toBeTruthy();
    expect(screen.getByText(/ask an administrator/i)).toBeTruthy();
  });
});
