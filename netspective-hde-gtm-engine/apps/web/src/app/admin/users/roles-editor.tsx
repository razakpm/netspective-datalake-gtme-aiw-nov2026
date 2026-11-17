"use client";
import { useState } from "react";
import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from "../../../lib/users-api.js";

export function RolesEditor({
  roles,
  onSave,
  disabled,
}: {
  roles: RoleKey[];
  onSave: (roles: RoleKey[]) => Promise<void>;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<RoleKey[]>(roles);
  return (
    <div>
      {ROLE_KEYS.map((role) => (
        <label key={role}>
          <input
            type="checkbox"
            checked={selected.includes(role)}
            onChange={(e) =>
              setSelected(
                e.target.checked ? [...selected, role] : selected.filter((r) => r !== role),
              )
            }
          />
          {ROLE_LABELS[role]}
        </label>
      ))}
      <button type="button" disabled={disabled} onClick={() => void onSave(selected)}>
        Save roles
      </button>
    </div>
  );
}
