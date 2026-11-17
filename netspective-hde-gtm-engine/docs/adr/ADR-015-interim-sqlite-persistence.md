# ADR-015: Interim SQLite persistence for local development and tests

- Status: Accepted (interim), 2026-11-13
- Decided by: project owner ("avoid persistence for the time being or use an sqlite solution")

## Context
The plan (research R-01, ADR-002) specifies PostgreSQL 16 with Drizzle and Testcontainers. The current
environment has no Docker, Podman or Postgres server, which blocked T010–T012 and T025–T028.

## Decision
Use Node's built-in `node:sqlite` as an interim adapter in `@gtm/db` (`SqliteDatabase`, forward-only
checksummed migrations in `packages/db/migrations-sqlite/`). Business code receives a `Tx` from
`db.transaction()` and does not open connections, so the Postgres adapter can replace it. Features that
do not need persistence proceed without it.

## Consequences
- Not equivalent to Postgres: no monthly audit partitions, no `text[]`/`jsonb`, no `FOR UPDATE SKIP LOCKED`
  (the dispatcher is single-process), no row-level locking. Append-only audit is enforced by triggers.
- By the project owner's decision (2026-11-13: "as a first version, skip risks with local database
  settings"), tasks whose acceptance names Postgres are ticked on the SQLite implementation. This is a
  first version, not production readiness.
- **Deferred to the Postgres adapter** (must be done and re-verified before production): the real
  Postgres migrations (0001–0005 and later) with citext, enums, `text[]` and `jsonb`; monthly audit
  partitions and partition-drop retention; the application database role with INSERT/SELECT only and a
  separate privileged retention role; row locking and `FOR UPDATE SKIP LOCKED` in the dispatcher and job
  queue; Testcontainers integration runs; advisory-lock chain serialisation; Drizzle schema and the
  Drizzle-based classification enumeration.
- SQLite is never a production target. `node:sqlite` is experimental on Node 22 LTS; this is acceptable
  for local/test use only.
- Retire this ADR when the Postgres adapter and Testcontainers tests land.
