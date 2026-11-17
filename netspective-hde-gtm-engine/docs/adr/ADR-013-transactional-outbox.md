# ADR-013: Event model — transactional outbox

- **Status**: Proposed (accept after human review of the Feature 001 plan)
- **Date**: 2026-11-02
- **Feature**: 001
- **Related principles**: XVI Modular monolith first; III Provenance; engineering standards (idempotency keys, correlation IDs)

## Context
Modules may interact only through public indexes and domain events. Events must not be lost if the process crashes between a state change and publication, and consumers must be able to deduplicate.

## Decision
Domain events are written to an `outbox_event` table in the same transaction as the state change and its audit event. An in-process dispatcher reads pending rows with `FOR UPDATE SKIP LOCKED`, delivers to module subscribers, and marks them dispatched. The envelope is `{event_id, type, schema_version, occurred_at, actor, correlation_id, causation_id, idempotency_key, payload, provenance}`; consumers deduplicate on `event_id` or `idempotency_key`. Payloads pass through the PHI guard.

## Alternatives considered
- **Direct in-process pub/sub**: loses events on crash. Rejected.
- **External broker (Kafka, RabbitMQ)**: extra infrastructure at this scale. Rejected for MVP.
- **Change-data-capture**: operational complexity. Rejected.

## Consequences
- Positive: at-least-once delivery without extra infrastructure; versioned envelopes support evolution.
- Negative: subscribers must be idempotent; the dispatcher needs monitoring for lag.
