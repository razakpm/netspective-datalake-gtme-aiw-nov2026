import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  canAssignRole,
  checkRoleRemoval,
  checkTransition,
  effectivePermissions,
  ROLE_KEYS,
  type AuditEventInput,
  type Permission,
  type RoleKey,
  type UserStatus,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit/index.js";
import { HttpError } from "../../http/errors.js";
import { writeOutbox } from "../../platform/events/outbox.js";
import type { VerifiedIdentity } from "./oidc.js";

// User and role management (task T045). Every change runs in one transaction with its audit event and
// outbox event. Roles and permissions are read from the database on every call, never from tokens.

export const INVITATION_DAYS = 7;

export interface Principal {
  userId: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  roles: RoleKey[];
  permissions: Permission[];
}

export type ResolveResult =
  | { kind: "ok"; principal: Principal }
  | {
      kind: "denied";
      reason: "not_invited" | "deactivated" | "invitation_expired" | "subject_mismatch";
    };

export interface UserView {
  id: string;
  email: string;
  /** Omitted when unset: the contract declares an optional string, not null. */
  displayName?: string;
  status: UserStatus;
  roles: RoleKey[];
  invitationExpiresAt: string | null;
  lastSignInAt: string | null;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  status: UserStatus;
  idp_subject: string | null;
  last_sign_in_at: string | null;
  created_at: string;
}

export interface Actor {
  userId: string;
  correlationId: string | null;
}

export class IdentityService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ---- sign-in and per-request resolution --------------------------------------------------------

  /** Resolve (and on first sign-in activate) the user for a verified identity. */
  resolvePrincipal(identity: VerifiedIdentity, correlationId: string | null): ResolveResult {
    return this.db.transaction((tx) => {
      let row = this.userBySubject(tx, identity.sub);
      if (!row) {
        const byEmail = this.userByEmail(tx, identity.email);
        if (!byEmail) return { kind: "denied", reason: "not_invited" } as const;
        if (byEmail.idp_subject !== null && byEmail.idp_subject !== identity.sub) {
          return { kind: "denied", reason: "subject_mismatch" } as const;
        }
        row = byEmail;
      }
      if (row.status === "deactivated") return { kind: "denied", reason: "deactivated" } as const;

      if (row.status === "invited") {
        const invitation = tx
          .prepare(
            "SELECT id, expires_at, status FROM invitation WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
          )
          .get(row.id) as { id: string; expires_at: string; status: string } | undefined;
        if (!invitation || invitation.status !== "pending" || invitation.expires_at <= this.iso()) {
          if (invitation?.status === "pending") {
            tx.prepare("UPDATE invitation SET status = 'expired' WHERE id = ?").run(invitation.id);
          }
          return { kind: "denied", reason: "invitation_expired" } as const;
        }
        this.activate(tx, row, identity, invitation.id, correlationId);
        row = { ...row, status: "active", idp_subject: identity.sub };
      } else if (row.idp_subject === null) {
        tx.prepare('UPDATE "user" SET idp_subject = ?, last_sign_in_at = ? WHERE id = ?').run(
          identity.sub,
          this.iso(),
          row.id,
        );
      }
      return { kind: "ok", principal: this.principalFor(tx, row) } as const;
    });
  }

  private activate(
    tx: Tx,
    row: UserRow,
    identity: VerifiedIdentity,
    invitationId: string,
    correlationId: string | null,
  ): void {
    const check = checkTransition({
      from: "invited",
      to: "active",
      isAdministrator: false,
      activeAdministrators: this.activeAdministrators(tx),
    });
    if (!check.ok) throw new HttpError(409, "Illegal status change");
    tx.prepare(
      "UPDATE \"user\" SET status = 'active', idp_subject = ?, last_sign_in_at = ?, display_name = COALESCE(display_name, ?) WHERE id = ?",
    ).run(identity.sub, this.iso(), identity.name, row.id);
    tx.prepare("UPDATE invitation SET status = 'accepted' WHERE id = ?").run(invitationId);
    this.audit(tx, {
      actorId: row.id,
      actorType: "human",
      action: "user.activated",
      entityType: "user",
      entityId: row.id,
      outcome: "success",
      before: { status: "invited" },
      after: { status: "active" },
      correlationId,
    });
    this.emit(tx, "user.activated", row.id, { userId: row.id }, correlationId);
  }

  private principalFor(tx: Tx, row: UserRow): Principal {
    const roles = this.rolesOf(tx, row.id);
    const rolePerms = roles.map((key) => ({
      key,
      permissions: (
        tx.prepare("SELECT permission_key k FROM role_permission WHERE role_id = ?").all(key) as {
          k: string;
        }[]
      ).map((r) => r.k),
    }));
    return {
      userId: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      roles,
      permissions: effectivePermissions(rolePerms),
    };
  }

  /** Record a refused access attempt in its own transaction, so it survives a rolled-back request. */
  recordDenied(event: AuditEventInput): void {
    this.db.transaction((tx) => recordAudit(tx, event));
  }

  // ---- queries ----------------------------------------------------------------------------------

  listUsers(options: { status?: UserStatus; cursor?: string; limit?: number }): {
    items: UserView[];
    nextCursor: string | null;
  } {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM "user" WHERE (? IS NULL OR status = ?) AND (? IS NULL OR id > ?)
         ORDER BY id LIMIT ?`,
      )
      .all(
        options.status ?? null,
        options.status ?? null,
        options.cursor ?? null,
        options.cursor ?? null,
        limit + 1,
      ) as unknown as UserRow[];
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => this.view(this.db.raw, r)),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  getUser(userId: string): UserView {
    const row = this.userById(this.db.raw, userId);
    if (!row) throw notFound();
    return this.view(this.db.raw, row);
  }

  listRoles(): { key: RoleKey; name: string; permissions: string[] }[] {
    const roles = this.db.raw.prepare("SELECT key, name FROM role ORDER BY key").all() as {
      key: RoleKey;
      name: string;
    }[];
    return roles.map((r) => ({
      ...r,
      permissions: (
        this.db.raw
          .prepare("SELECT permission_key k FROM role_permission WHERE role_id = ? ORDER BY 1")
          .all(r.key) as { k: string }[]
      ).map((p) => p.k),
    }));
  }

  // ---- commands (each in one transaction with audit and outbox) ----------------------------------

  invite(
    actor: Actor,
    input: { email: string; displayName?: string | undefined; roles: RoleKey[] },
    tx: Tx,
  ): UserView {
    const email = input.email.trim().toLowerCase();
    if (this.userByEmail(tx, email)) {
      throw new HttpError(409, "Conflict", "A user with this email already exists");
    }
    this.assertRolesExist(tx, input.roles);
    for (const key of input.roles) this.assertAssignable(tx, key);

    const id = uuidv7();
    const now = this.iso();
    tx.prepare(
      `INSERT INTO "user" (id, email, display_name, status, invited_by, created_at)
       VALUES (?, ?, ?, 'invited', ?, ?)`,
    ).run(id, email, input.displayName ?? null, actor.userId, now);
    tx.prepare(
      `INSERT INTO invitation (id, user_id, expires_at, status, invited_by, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    ).run(uuidv7(), id, this.iso(INVITATION_DAYS), actor.userId, now);
    this.writeRoles(tx, id, input.roles, actor.userId);

    this.audit(tx, {
      actorId: actor.userId,
      actorType: "human",
      action: "user.invited",
      entityType: "user",
      entityId: id,
      outcome: "success",
      after: { status: "invited", roles: input.roles },
      correlationId: actor.correlationId,
    });
    this.emit(
      tx,
      "user.invited",
      actor.userId,
      { userId: id, roles: input.roles },
      actor.correlationId,
    );
    return this.view(tx, this.userById(tx, id)!);
  }

  setRoles(actor: Actor, userId: string, roles: RoleKey[], tx: Tx): UserView {
    const row = this.userById(tx, userId);
    if (!row) throw notFound();
    this.assertRolesExist(tx, roles);
    for (const key of roles) this.assertAssignable(tx, key);

    const before = this.rolesOf(tx, userId);
    if (before.includes("administrator") && !roles.includes("administrator")) {
      const check = checkRoleRemoval({
        roleKey: "administrator",
        userIsActive: row.status === "active",
        activeAdministrators: this.activeAdministrators(tx),
      });
      if (!check.ok) throw lastAdministrator();
    }
    tx.prepare("DELETE FROM user_role WHERE user_id = ?").run(userId);
    this.writeRoles(tx, userId, roles, actor.userId);
    this.audit(tx, {
      actorId: actor.userId,
      actorType: "human",
      action: "user.roles.set",
      entityType: "user",
      entityId: userId,
      outcome: "success",
      before: { roles: before },
      after: { roles },
      correlationId: actor.correlationId,
    });
    this.emit(tx, "user.roles.changed", actor.userId, { userId, roles }, actor.correlationId);
    return this.view(tx, row);
  }

  deactivate(actor: Actor, userId: string, tx: Tx): UserView {
    return this.changeStatus(tx, actor, userId, "deactivated", "user.deactivated");
  }

  reactivate(actor: Actor, userId: string, tx: Tx): UserView {
    return this.changeStatus(tx, actor, userId, "active", "user.reactivated");
  }

  private changeStatus(
    tx: Tx,
    actor: Actor,
    userId: string,
    to: UserStatus,
    action: "user.deactivated" | "user.reactivated",
  ): UserView {
    const row = this.userById(tx, userId);
    if (!row) throw notFound();
    const check = checkTransition({
      from: row.status,
      to,
      isAdministrator: this.rolesOf(tx, userId).includes("administrator"),
      activeAdministrators: this.activeAdministrators(tx),
    });
    if (!check.ok) {
      if (check.reason === "last_administrator") throw lastAdministrator();
      throw new HttpError(409, "Conflict", `Cannot change status from ${row.status} to ${to}`);
    }
    tx.prepare('UPDATE "user" SET status = ? WHERE id = ?').run(to, userId);
    if (row.status === "invited") {
      tx.prepare(
        "UPDATE invitation SET status = 'revoked' WHERE user_id = ? AND status = 'pending'",
      ).run(userId);
    }
    this.audit(tx, {
      actorId: actor.userId,
      actorType: "human",
      action,
      entityType: "user",
      entityId: userId,
      outcome: "success",
      before: { status: row.status },
      after: { status: to },
      correlationId: actor.correlationId,
    });
    this.emit(tx, action, actor.userId, { userId }, actor.correlationId);
    return this.view(tx, { ...row, status: to });
  }

  // ---- helpers ----------------------------------------------------------------------------------

  private audit(tx: Tx, event: AuditEventInput): void {
    recordAudit(tx, event, this.now);
  }

  private emit(
    tx: Tx,
    type: string,
    actorId: string | null,
    payload: Record<string, unknown>,
    correlationId: string | null,
  ): void {
    writeOutbox(
      tx,
      {
        type,
        actor: { id: actorId, type: "human" },
        correlation_id: correlationId,
        causation_id: null,
        idempotency_key: null,
        payload,
        provenance: { source: "identity" },
      },
      this.now,
    );
  }

  private iso(plusDays = 0): string {
    return new Date(this.now().getTime() + plusDays * 86_400_000).toISOString();
  }

  private assertRolesExist(tx: Tx, roles: readonly string[]): void {
    for (const key of roles) {
      if (
        !(ROLE_KEYS as readonly string[]).includes(key) ||
        !tx.prepare("SELECT 1 FROM role WHERE key = ?").get(key)
      ) {
        throw new HttpError(422, "Unknown role", "One or more roles do not exist");
      }
    }
  }

  /** Users are always human here, but every assignment path still calls the domain rule (FR-009). */
  private assertAssignable(tx: Tx, roleKey: string): void {
    const permissions = (
      tx.prepare("SELECT permission_key k FROM role_permission WHERE role_id = ?").all(roleKey) as {
        k: string;
      }[]
    ).map((r) => r.k);
    const decision = canAssignRole("human", { key: roleKey, permissions });
    if (!decision.allowed) throw new HttpError(422, "Role cannot be assigned");
  }

  private writeRoles(tx: Tx, userId: string, roles: readonly string[], assignedBy: string): void {
    const insert = tx.prepare(
      "INSERT INTO user_role (user_id, role_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)",
    );
    for (const key of new Set(roles)) insert.run(userId, key, assignedBy, this.iso());
  }

  activeAdministrators(tx: Tx = this.db.raw): number {
    return (
      tx
        .prepare(
          `SELECT count(*) c FROM "user" u JOIN user_role ur ON ur.user_id = u.id
           WHERE u.status = 'active' AND ur.role_id = 'administrator'`,
        )
        .get() as { c: number }
    ).c;
  }

  private rolesOf(tx: Tx, userId: string): RoleKey[] {
    return (
      tx.prepare("SELECT role_id k FROM user_role WHERE user_id = ? ORDER BY 1").all(userId) as {
        k: RoleKey;
      }[]
    ).map((r) => r.k);
  }

  private view(tx: Tx, row: UserRow): UserView {
    const invitation = tx
      .prepare(
        "SELECT expires_at FROM invitation WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      )
      .get(row.id) as { expires_at: string } | undefined;
    return {
      id: row.id,
      email: row.email,
      ...(row.display_name ? { displayName: row.display_name } : {}),
      status: row.status,
      roles: this.rolesOf(tx, row.id),
      invitationExpiresAt: invitation?.expires_at ?? null,
      lastSignInAt: row.last_sign_in_at,
      createdAt: row.created_at,
    };
  }

  private userById(tx: Tx, id: string): UserRow | undefined {
    return tx.prepare('SELECT * FROM "user" WHERE id = ?').get(id) as UserRow | undefined;
  }
  private userByEmail(tx: Tx, email: string): UserRow | undefined {
    return tx.prepare('SELECT * FROM "user" WHERE email = ?').get(email) as UserRow | undefined;
  }
  private userBySubject(tx: Tx, sub: string): UserRow | undefined {
    return tx.prepare('SELECT * FROM "user" WHERE idp_subject = ?').get(sub) as UserRow | undefined;
  }
}

function notFound(): HttpError {
  return new HttpError(404, "Not found");
}

function lastAdministrator(): HttpError {
  return new HttpError(409, "Conflict", "This would remove the last active administrator", {
    type: "urn:gtm:problem:last-administrator",
  });
}
