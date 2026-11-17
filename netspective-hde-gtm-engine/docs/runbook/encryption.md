# Encryption runbook

Spec FR-051 and SC-012. All traffic is encrypted in transit and all stored data is encrypted at rest.
This feature enforces what the process can check by itself (transport) and documents what the platform
must provide (at rest). Hosting is not decided yet (open question #16), so nothing here names a cloud.

## In transit: enforced by the application at start-up

In production the API refuses to start unless all of these hold (`apps/api/src/config/tls.ts`,
tested in `apps/api/test/tls-config.test.ts`). The web app does the same for its API URL
(`apps/web/src/config.ts`).

| Connection | Requirement | Setting |
|---|---|---|
| API to PostgreSQL | `sslmode` is `require`, `verify-ca` or `verify-full` (prefer `verify-full`) | `DATABASE_URL` |
| API to identity provider | `https` | `OIDC_ISSUER_URL` |
| Web to API | `https` | `API_BASE_URL` (web) |
| Users to web, senders to API | TLS terminated at the platform edge | platform |

Errors name the setting and never print the URL or its credentials.

## At rest: platform requirement, verified by a person

The application cannot check these, so each is verified by a named person before the first real
deployment and again after any hosting change. Record the date and the verifier in the deployment
record, not in this repository.

| # | Requirement | How to verify | Verified by | Date |
|---|---|---|---|---|
| 1 | The PostgreSQL volume and its backups are encrypted at rest | Provider console or CLI shows encryption enabled for the instance, volume and snapshots | | |
| 2 | Object storage used by the file storage adapter is encrypted at rest | Bucket default encryption enabled; no unencrypted objects | | |
| 3 | Quarantined content is encrypted by the application | Quarantine integration test passes (task T067); `QUARANTINE_ENCRYPTION_KEY` is supplied by the secret manager and is not stored in the database | | |
| 4 | Backups and log storage are encrypted | Provider setting enabled; retention matches spec FR-053 | | |
| 5 | Secrets come from the platform secret manager, not from files in this repository | Secret scan is green in CI; `.env` files are absent from images (`.dockerignore`) | | |

## Key handling

- `QUARANTINE_ENCRYPTION_KEY` is at least 32 characters, generated randomly, supplied through the
  environment, and registered with the logger so it can never appear in log output.
- Rotation: introduce a new key, re-encrypt held quarantine items, then retire the old key. Quarantine
  items are held for 30 days at most (spec FR-053), so the overlap window is short.
