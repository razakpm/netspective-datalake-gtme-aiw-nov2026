"use client";
import { useState, type FormEvent } from "react";
import { newIdempotencyKey, ROLE_KEYS, ROLE_LABELS, type RoleKey } from "../../../lib/users-api.js";

export function InviteForm({
  onInvite,
  disabled,
}: {
  onInvite: (body: { email: string; roles: RoleKey[] }, key: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<RoleKey[]>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onInvite({ email: email.trim(), roles }, newIdempotencyKey());
    setEmail("");
    setRoles([]);
  }

  return (
    <form onSubmit={submit} aria-label="Invite a user">
      <label>
        Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <fieldset>
        <legend>Roles</legend>
        {ROLE_KEYS.map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={(e) =>
                setRoles(e.target.checked ? [...roles, role] : roles.filter((r) => r !== role))
              }
            />
            {ROLE_LABELS[role]}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={disabled}>
        Invite
      </button>
    </form>
  );
}
