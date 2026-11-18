// Permission-gated navigation (task T048). Hiding links is a convenience only: the API enforces every
// permission on every request (spec FR-006).

export interface NavItem {
  label: string;
  href: string;
  permission: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Users", href: "/admin/users", permission: "users.manage" },
  { label: "Audit", href: "/admin/audit", permission: "audit.read" },
  { label: "Jobs", href: "/admin/jobs", permission: "jobs.read" },
  { label: "Signals", href: "/signals", permission: "signals.read" },
  { label: "Webhooks", href: "/webhooks", permission: "webhooks.read" },
  { label: "Quarantine", href: "/admin/quarantine", permission: "quarantine.review" },
  { label: "AI invocations", href: "/ai-invocations", permission: "ai_invocations.read" },
  { label: "Providers", href: "/providers", permission: "providers.manage" },
];

export function visibleNavItems(permissions: readonly string[]): NavItem[] {
  const held = new Set(permissions);
  return NAV_ITEMS.filter((item) => held.has(item.permission));
}

export function Nav({ permissions }: { permissions: readonly string[] }) {
  const items = visibleNavItems(permissions);
  if (items.length === 0) return null;
  return (
    <nav aria-label="Main">
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href}>{item.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
