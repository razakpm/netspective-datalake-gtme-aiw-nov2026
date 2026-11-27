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

  it("shows Offers, Capabilities and Claims only with their read permissions", () => {
    expect(visibleNavItems(["offers.read"]).map((i) => i.label)).toEqual(["Offers"]);
    expect(visibleNavItems(["capabilities.read", "claims.read"]).map((i) => i.label)).toEqual([
      "Capabilities",
      "Claims",
    ]);
    render(<Nav permissions={["offers.read"]} />);
    expect(screen.getByRole("link", { name: "Offers" }).getAttribute("href")).toBe("/offers");
    expect(screen.queryByRole("link", { name: "Claims" })).toBeNull();
  });

  it("shows Requests with requests.read and Notices with notices.manage, both on the request page", () => {
    expect(visibleNavItems(["requests.read"]).map((i) => i.label)).toEqual(["Requests"]);
    expect(visibleNavItems(["notices.manage", "notices.approve"]).map((i) => i.label)).toEqual([
      "Notices",
    ]);
    render(<Nav permissions={["requests.read", "notices.manage"]} />);
    expect(screen.getByRole("link", { name: "Requests" }).getAttribute("href")).toBe("/requests");
    expect(screen.getByRole("link", { name: "Notices" }).getAttribute("href")).toBe("/requests");
  });

  it("shows Workshops with workshops.read (feature 007)", () => {
    expect(visibleNavItems(["workshops.read"]).map((i) => i.label)).toEqual(["Workshops"]);
    render(<Nav permissions={["workshops.read"]} />);
    expect(screen.getByRole("link", { name: "Workshops" }).getAttribute("href")).toBe("/workshops");
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
