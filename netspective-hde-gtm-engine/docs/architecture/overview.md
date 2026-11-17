# Architecture Overview — Foundation (Feature 001)

Modular monolith: one API codebase running HTTP and worker roles, an internal web app, and PostgreSQL as the single system of record (data, job queue, outbox). See [ADR-001](../adr/ADR-001-modular-monolith.md), [ADR-002](../adr/ADR-002-postgresql-system-of-record.md), [ADR-004](../adr/ADR-004-non-phi-data-boundary.md), [ADR-006](../adr/ADR-006-provider-adapter-pattern.md), [ADR-013](../adr/ADR-013-transactional-outbox.md) and [ADR-014](../adr/ADR-014-company-oidc-authentication.md).

## Component diagram

```mermaid
flowchart LR
  subgraph Users
    U[Internal user]
  end
  IDP[(Company OIDC provider)]
  SENDER[Webhook sender]

  subgraph Web["apps/web (Next.js)"]
    WEBUI[Operator UI]
    AUTHJS[Auth.js server-side session]
  end

  subgraph API["apps/api (Fastify, one codebase)"]
    direction TB
    HTTP[HTTP role]
    WORKER[Worker role]
    subgraph MW[Request pipeline]
      CORR[Correlation-ID middleware]
      JWT[OIDC token verification]
      AUTHZ[RBAC check from DB]
      GUARD[PHI guard middleware]
    end
    subgraph MODS["modules (public index + events only)"]
      IDENT[identity]
      AUDIT[audit]
      JOBS[jobs]
      PROV[providers + LLM gateway]
      STUBS[later feature modules: empty stubs]
    end
    DISP[In-process event dispatcher]
  end

  subgraph PKG[Shared packages]
    DOM[packages/domain: rules, schemas, privacy guard]
    AIC[packages/ai-contracts]
    PRV[packages/providers: interfaces, fakes, adapters]
    DBP[packages/db: schema, migrations, seed]
  end

  PG[(PostgreSQL 16: data, pg-boss queue, outbox, audit)]
  EXT[External services: research, public data, enrichment, LLM, email, calendar, CRM, storage]

  U --> WEBUI
  WEBUI --> AUTHJS --> IDP
  WEBUI -->|ID token| HTTP
  SENDER -->|signed delivery| HTTP
  HTTP --> CORR --> JWT --> AUTHZ --> GUARD --> MODS
  WORKER --> MODS
  MODS --> DOM
  MODS --> DBP --> PG
  JOBS <--> PG
  AUDIT --> PG
  MODS --> DISP
  PG -. outbox .-> DISP
  PROV --> PRV
  PROV -->|PHI pre-flight, schema validation| AIC
  PRV -. only via adapters .-> EXT
```

## Key flows

### Authorised state change
```mermaid
sequenceDiagram
  participant W as Web
  participant A as API
  participant D as Postgres
  W->>A: request + ID token + Idempotency-Key
  A->>A: correlation ID, verify token
  A->>D: load user, roles, permissions (every request)
  A->>A: PHI guard on body
  A->>D: BEGIN; change + audit_event + outbox_event; COMMIT
  A-->>W: result (denied → 403 + audit event)
```

### Webhook ingress
```mermaid
sequenceDiagram
  participant S as Sender
  participant A as API
  participant D as Postgres
  S->>A: POST /webhooks/{source}
  A->>A: size limit, timestamp skew, signature on raw bytes
  A->>A: PHI guard on in-memory body
  alt blocked
    A->>D: metadata-only row, audit event
    A-->>S: 422
  else allowed
    A->>D: raw row (verification status), unique delivery id
    A->>D: enqueue job (source + delivery id) if verified
    A-->>S: 202 (or 200 duplicate)
  end
```

## Boundaries enforced by lint
- Modules import only another module's public `index.ts`, or react to its events.
- Rule modules in `packages/domain` cannot import `packages/providers` or `packages/ai-contracts` (deterministic rules, never an LLM).
- Vendor SDKs are importable only inside provider adapters.
- No real network access in tests.

## Out of scope here
GTM business modules (accounts through analytics) exist as empty folders; cloud deployment target is deferred (open question #16).
