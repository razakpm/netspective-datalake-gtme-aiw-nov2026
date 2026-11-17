# ADR-002: PostgreSQL as system of record

- **Status**: Proposed (accept after human review of the Feature 001 plan)
- **Date**: 2026-11-02
- **Feature**: 001
- **Related principles**: XVI Modular monolith first; IV Non-PHI by default; engineering standards (forward-only migrations)

## Context
The system needs relational data, an audit trail committed atomically with state changes, a job queue, and an event outbox, with minimal infrastructure.

## Decision
PostgreSQL 16 is the system of record. Drizzle ORM with drizzle-kit forward-only migrations; UUIDv7 primary keys; `created_at`/`updated_at` columns; soft-delete only where retention requires. `pg_trgm` is reserved for fuzzy matching in later features. pg-boss provides jobs on the same database; the transactional outbox and the audit table also live here. `audit_event` is append-only and partitioned monthly.

## Alternatives considered
- **Prisma**: weaker control over triggers, partitioning and raw SQL. Rejected.
- **Document store for audit/events**: loses atomic commit with state changes. Rejected.
- **Redis plus Postgres (BullMQ)**: extra infrastructure for jobs. Rejected for MVP (see research R-05).

## Consequences
- Positive: one backup, one transaction boundary, one technology to operate.
- Negative: queue throughput is bounded by Postgres; acceptable at this scale.
- Rollback is by a new forward migration; migrations are reviewed.
- Retention of audit data is done by dropping partitions via an audited maintenance command.
