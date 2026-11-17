-- Interim SQLite migration (ADR-015). Forward-only. Classification: som unless noted; bc = business contact.
CREATE TABLE "user" (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE CHECK (email = lower(email)),   -- bc
  display_name     TEXT,                                                -- bc
  status           TEXT NOT NULL CHECK (status IN ('invited','active','deactivated')),
  idp_subject      TEXT UNIQUE,
  invited_by       TEXT REFERENCES "user"(id),
  last_sign_in_at  TEXT,
  created_at       TEXT NOT NULL
);

CREATE TABLE invitation (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES "user"(id),
  expires_at  TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending','accepted','expired','revoked')),
  invited_by  TEXT REFERENCES "user"(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE role (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE permission (
  key         TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE role_permission (
  role_id        TEXT NOT NULL REFERENCES role(id),
  permission_key TEXT NOT NULL REFERENCES permission(key),
  PRIMARY KEY (role_id, permission_key)
);

-- Human users only: the foreign key keeps AI and system actors out (FR-009).
CREATE TABLE user_role (
  user_id     TEXT NOT NULL REFERENCES "user"(id),
  role_id     TEXT NOT NULL REFERENCES role(id),
  assigned_by TEXT REFERENCES "user"(id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);
