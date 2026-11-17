# ADR-014: Authentication via company OIDC

- **Status**: Proposed (accept after human review of the Feature 001 plan)
- **Date**: 2026-11-02
- **Feature**: 001
- **Related principles**: VIII Human approval; security baseline (RBAC, least privilege, audit)

## Context
Only internal staff use the system. Open question #8 (Google Workspace or Microsoft Entra) is unresolved. The spec forbids local passwords (FR-002) and requires role changes to take effect by the user's next request.

## Decision
OIDC with a configurable provider. Auth.js in `apps/web` performs sign-in; the API verifies the user's ID token (signature through the provider's key set, issuer, audience, expiry) and loads the user, roles and permissions from the application database on every request. RBAC tables: user, role, permission, user_role (plus role_permission). Roles and permissions are never read from token claims. Only invited or active users may sign in. A fake OIDC issuer is used in tests and local development until open question #8 is decided; production refuses it. The first administrator is created by an audited bootstrap command.

## Alternatives considered
- **Email magic link**: adds an email dependency and a local credential path. Rejected.
- **Roles in token claims**: stale after role changes and requires revocation machinery. Rejected.
- **API-issued sessions**: more code with no benefit at this scale. Rejected.

## Consequences
- Positive: no credential storage; immediate effect of role changes and deactivation; provider choice is configuration.
- Negative: one indexed database lookup per request; new sign-ins fail during an identity provider outage (existing sessions continue until expiry).
- Session lifetimes (8 h absolute, 30 min idle) are hypotheses to confirm.
