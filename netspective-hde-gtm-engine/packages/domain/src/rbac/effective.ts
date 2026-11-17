import { isPermission, type Permission } from "./permissions.js";

export interface RoleLike {
  key: string;
  permissions: readonly string[];
}

/** Union of the roles' permissions, sorted. No deny rules; unknown keys are ignored; none means none. */
export function effectivePermissions(roles: readonly RoleLike[]): Permission[] {
  const union = new Set<Permission>();
  for (const role of roles) {
    for (const key of role.permissions) if (isPermission(key)) union.add(key);
  }
  return [...union].sort();
}

export function hasPermission(roles: readonly RoleLike[], permission: Permission): boolean {
  return effectivePermissions(roles).includes(permission);
}
