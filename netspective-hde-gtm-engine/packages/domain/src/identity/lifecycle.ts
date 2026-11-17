// User lifecycle rules (spec FR-007). Pure: callers pass the facts, including the count of active
// administrators read under a lock, and persist the result.

export const USER_STATUSES = ["invited", "active", "deactivated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

const LEGAL: Readonly<Record<UserStatus, readonly UserStatus[]>> = {
  invited: ["active", "deactivated"],
  active: ["deactivated"],
  deactivated: ["active"],
};

export type LifecycleResult =
  { ok: true } | { ok: false; reason: "illegal_transition" | "last_administrator" };

export interface TransitionInput {
  from: UserStatus;
  to: UserStatus;
  /** Whether the user currently holds the administrator role. */
  isAdministrator: boolean;
  /** Active administrators right now, including this user if they are one. */
  activeAdministrators: number;
}

export function checkTransition(input: TransitionInput): LifecycleResult {
  const allowed = LEGAL[input.from] as readonly UserStatus[] | undefined;
  if (!allowed?.includes(input.to)) return { ok: false, reason: "illegal_transition" };
  if (
    input.from === "active" &&
    input.to !== "active" &&
    input.isAdministrator &&
    input.activeAdministrators <= 1
  ) {
    return { ok: false, reason: "last_administrator" };
  }
  return { ok: true };
}

export interface RoleRemovalInput {
  roleKey: string;
  userIsActive: boolean;
  activeAdministrators: number;
}

export function checkRoleRemoval(input: RoleRemovalInput): LifecycleResult {
  if (input.roleKey === "administrator" && input.userIsActive && input.activeAdministrators <= 1) {
    return { ok: false, reason: "last_administrator" };
  }
  return { ok: true };
}
