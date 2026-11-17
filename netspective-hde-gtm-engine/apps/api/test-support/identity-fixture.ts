import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import type { RoleKey } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { createAuthz } from "../src/http/authz.js";
import {
  createPhiGuardSink,
  QuarantineService,
  registerAuditRoutes,
  registerQuarantineRoutes,
} from "../src/modules/audit/index.js";
import { JobService, registerJobRoutes } from "../src/modules/jobs/index.js";
import { AccountService, registerAccountRoutes } from "../src/modules/accounts/index.js";
import { PhiNotifier } from "../src/platform/events/phi-notifier.js";
import { registerIdentityRoutes } from "../src/modules/identity/index.js";
import { IdentityService, OidcVerifier } from "../src/modules/identity/index.js";
import { buildTestServer, type TestServer } from "../test/helpers.js";
import { FakeIssuer } from "./fake-oidc/issuer.js";

// A running API with the identity routes, an in-memory SQLite database, seeded reference data and a
// fake OIDC issuer (ADR-015). Used by the US1 contract and integration tests.

export const ISSUER = "http://fake-idp.example.org";
export const AUDIENCE = "gtm-engine";

export const QUARANTINE_KEY = "quarantine-test-key-0123456789abcdef-not-real";

export interface FixtureOptions {
  /** Entry points that hold content for review instead of rejecting it. */
  quarantineEntryPoints?: string[];
}

export interface IdentityFixture extends TestServer {
  db: SqliteDatabase;
  issuer: FakeIssuer;
  service: IdentityService;
  quarantine: QuarantineService;
  notifier: PhiNotifier;
  jobs: JobService;
  accounts: AccountService;
  /** Insert an active user directly (bypassing the API) and return a bearer token for them. */
  makeUser(
    email: string,
    roles?: RoleKey[],
    status?: "active" | "invited" | "deactivated",
  ): Promise<{ id: string; sub: string; token: string }>;
  /** Mint a token for any identity, whether or not a user row exists. */
  tokenFor(sub: string, email: string, options?: { expiresInSeconds?: number }): Promise<string>;
  clock: { now: Date };
  /** Set `available = false` to simulate an identity provider outage (key fetch fails). */
  idp: { available: boolean };
  /** Every route registered on the server, from the Fastify registry (used by the audit-coverage test). */
  routes: { method: string; url: string }[];
}

export async function buildIdentityFixture(options: FixtureOptions = {}): Promise<IdentityFixture> {
  const db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  const issuer = await FakeIssuer.create({ issuer: ISSUER, audience: AUDIENCE });
  const clock = { now: new Date() };
  const idp = { available: true };
  const routes: { method: string; url: string }[] = [];
  const service = new IdentityService(db, () => clock.now);
  const verifier = new OidcVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    fetchJwks: async () => {
      if (!idp.available) throw new Error("idp down");
      return issuer.jwks();
    },
  });
  const authz = createAuthz({
    verifier,
    resolve: (identity, correlationId) => service.resolvePrincipal(identity, correlationId),
    auditDenied: (event) => service.recordDenied(event),
  });
  const quarantine = new QuarantineService(db, QUARANTINE_KEY);
  const notifier = new PhiNotifier(60_000);
  const jobs = new JobService(db, { now: () => clock.now });
  const accounts = new AccountService(db);
  const server = await buildTestServer({
    phiGuardSink: createPhiGuardSink(db, notifier),
    ...(options.quarantineEntryPoints
      ? {
          guardPolicy: { quarantineEntryPoints: options.quarantineEntryPoints as never },
          quarantine: { hold: (input) => db.transaction((tx) => quarantine.hold(tx, input)) },
        }
      : {}),
    routes: (app) => {
      app.addHook("onRoute", (route) => {
        for (const method of [route.method].flat()) routes.push({ method, url: route.url });
      });
      registerIdentityRoutes(app, { db, service, authz });
      registerAuditRoutes(app, { db, authz });
      registerQuarantineRoutes(app, { db, service: quarantine, authz });
      registerJobRoutes(app, { service: jobs, authz });
      registerAccountRoutes(app, {
        db,
        service: accounts,
        authz,
        limits: { maxBytes: 5_242_880, maxRows: 5000 },
      });
    },
  });

  return {
    ...server,
    db,
    issuer,
    service,
    quarantine,
    notifier,
    jobs,
    accounts,
    clock,
    idp,
    routes,
    tokenFor: (sub, email, options) =>
      issuer.mint({
        sub,
        email,
        ...(options?.expiresInSeconds !== undefined
          ? { expiresInSeconds: options.expiresInSeconds }
          : {}),
      }),
    async makeUser(email, roles = [], status = "active") {
      const id = uuidv7();
      const sub = `idp|${id}`;
      db.transaction((tx) => {
        tx.prepare(
          `INSERT INTO "user" (id, email, status, idp_subject, created_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(id, email, status, status === "invited" ? null : sub, new Date().toISOString());
        for (const role of roles) {
          tx.prepare("INSERT INTO user_role (user_id, role_id, assigned_at) VALUES (?, ?, ?)").run(
            id,
            role,
            new Date().toISOString(),
          );
        }
      });
      return { id, sub, token: await issuer.mint({ sub, email }) };
    },
  };
}
