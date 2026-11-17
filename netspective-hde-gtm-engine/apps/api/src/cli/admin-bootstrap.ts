import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../modules/audit/index.js";

// Bootstrap administrator command (task T046, research R-07): creates the first administrator when none
// exists. Operator-run, needs database access. The administrator signs in through the identity provider;
// first sign-in activates the invited record. Writes an audit event with actor type `system`.

export class BootstrapRefusedError extends Error {
  constructor() {
    super("an administrator already exists; bootstrap refused");
    this.name = "BootstrapRefusedError";
  }
}

export function bootstrapAdministrator(
  db: SqliteDatabase,
  email: string,
  now: () => Date = () => new Date(),
): { userId: string } {
  const normalised = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised))
    throw new Error("a valid --email is required");

  return db.transaction((tx) => {
    const existing = tx
      .prepare(
        `SELECT count(*) c FROM "user" u JOIN user_role ur ON ur.user_id = u.id
         WHERE ur.role_id = 'administrator' AND u.status IN ('active','invited')`,
      )
      .get() as { c: number };
    if (existing.c > 0) throw new BootstrapRefusedError();

    const id = uuidv7();
    const at = now().toISOString();
    tx.prepare(
      `INSERT INTO "user" (id, email, status, invited_by, created_at) VALUES (?, ?, 'invited', NULL, ?)`,
    ).run(id, normalised, at);
    tx.prepare(
      `INSERT INTO invitation (id, user_id, expires_at, status, invited_by, created_at)
       VALUES (?, ?, ?, 'pending', NULL, ?)`,
    ).run(uuidv7(), id, new Date(now().getTime() + 7 * 86_400_000).toISOString(), at);
    tx.prepare(
      "INSERT INTO user_role (user_id, role_id, assigned_by, assigned_at) VALUES (?, 'administrator', NULL, ?)",
    ).run(id, at);
    recordAudit(
      tx,
      {
        actorId: null,
        actorType: "system",
        action: "admin.bootstrap",
        entityType: "user",
        entityId: id,
        outcome: "success",
        after: { status: "invited", roles: ["administrator"] },
      },
      now,
    );
    return { userId: id };
  });
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

// Run only when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const email = argValue(process.argv, "--email");
  const dbPath = argValue(process.argv, "--db") ?? process.env["GTM_SQLITE_PATH"];
  if (!email || !dbPath) {
    console.error("usage: admin-bootstrap --email <email> --db <sqlite file> (or GTM_SQLITE_PATH)");
    process.exit(2);
  }
  const db = new SqliteDatabase(dbPath);
  try {
    migrate(db);
    db.transaction((tx) => seedReference(tx));
    const { userId } = bootstrapAdministrator(db, email);
    console.log(`administrator created (${userId}); they can now sign in`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "bootstrap failed");
    process.exit(1);
  } finally {
    db.close();
  }
}
