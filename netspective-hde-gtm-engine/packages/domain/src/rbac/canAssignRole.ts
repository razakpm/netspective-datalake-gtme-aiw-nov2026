import { isActorType, type ActorType } from "../actors.js";
import type { RoleLike } from "./effective.js";
import { isRestrictedPermission, RESTRICTED_ROLE_KEYS } from "./permissions.js";

export type AssignDecision =
  | { allowed: true }
  | { allowed: false; reason: "actor_not_human" | "restricted_role" | "restricted_permission" };

/**
 * AI and system actors may never hold administrator, approval or quarantine-review authority
 * (spec FR-009). Every role-assignment path calls this.
 */
export function canAssignRole(actorType: ActorType, role: RoleLike): AssignDecision {
  if (!isActorType(actorType)) return { allowed: false, reason: "actor_not_human" };
  if (actorType === "human") return { allowed: true };
  if (RESTRICTED_ROLE_KEYS.includes(role.key)) return { allowed: false, reason: "restricted_role" };
  if (role.permissions.some(isRestrictedPermission)) {
    return { allowed: false, reason: "restricted_permission" };
  }
  return { allowed: true };
}
