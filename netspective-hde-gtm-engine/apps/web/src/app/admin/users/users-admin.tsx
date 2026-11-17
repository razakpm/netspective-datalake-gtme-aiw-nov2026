"use client";
import { useCallback, useEffect, useState } from "react";
import {
  browserUsersApi,
  describeApiError,
  newIdempotencyKey,
  type RoleKey,
  type UserView,
  type UsersApi,
} from "../../../lib/users-api.js";
import { InviteForm } from "./invite-form.js";
import { RolesEditor } from "./roles-editor.js";

export function UsersAdmin({ api = browserUsersApi }: { api?: UsersApi }) {
  const [users, setUsers] = useState<UserView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .list()
      .then((page) => setUsers(page.items))
      .catch((e: unknown) => setError(describeApiError(e)));
  }, [api]);

  const run = useCallback(async (action: () => Promise<UserView>) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setUsers((current) =>
        current.some((u) => u.id === updated.id)
          ? current.map((u) => (u.id === updated.id ? updated : u))
          : [...current, updated],
      );
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section>
      <h1>Users</h1>
      {error ? <p role="alert">{error}</p> : null}
      <InviteForm disabled={busy} onInvite={(body, key) => run(() => api.invite(body, key))} />
      <ul>
        {users.map((user) => (
          <li key={user.id}>
            <span>{user.email}</span> <span>{user.status}</span>
            <RolesEditor
              roles={user.roles}
              disabled={busy}
              onSave={(roles: RoleKey[]) =>
                run(() => api.setRoles(user.id, roles, newIdempotencyKey()))
              }
            />
            {user.status === "deactivated" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => api.reactivate(user.id, newIdempotencyKey()))}
              >
                Reactivate
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => api.deactivate(user.id, newIdempotencyKey()))}
              >
                Deactivate
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
