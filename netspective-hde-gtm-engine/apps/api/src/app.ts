import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import type { Logger } from "pino";
import type { AppConfig } from "./config/index.js";
import { createAuthz } from "./http/authz.js";
import { buildServer } from "./http/server.js";
import {
  createPhiGuardSink,
  QuarantineService,
  registerAuditRoutes,
  registerQuarantineRoutes,
} from "./modules/audit/index.js";
import {
  httpJwksFetcher,
  IdentityService,
  OidcVerifier,
  registerIdentityRoutes,
} from "./modules/identity/index.js";
import { AccountService, registerAccountRoutes } from "./modules/accounts/index.js";
import { registerHypothesisRoutes } from "./modules/hypotheses/index.js";
import { registerResearchRoutes } from "./modules/research/index.js";
import { JobService, registerJobRoutes } from "./modules/jobs/index.js";
import {
  registerSignalRoutes,
  ReviewService,
  SignalService,
  SourceService,
} from "./modules/signals/index.js";
import { PhiNotifier } from "./platform/events/phi-notifier.js";
import { buildCatalogueStack, type CatalogueStack } from "./catalogue-stack.js";
import { registerCapabilityRoutes } from "./modules/capabilities/index.js";
import { registerClaimRoutes } from "./modules/claims/index.js";
import { registerOfferRoutes } from "./modules/offers/index.js";
import { buildResearchStack, type ResearchStack } from "./research-stack.js";

// Composition root: builds the database, services and routes from configuration. The persistence is
// SQLite for the first version (ADR-015); the Postgres adapter replaces `SqliteDatabase` here.

export interface Services {
  db: SqliteDatabase;
  jobs: JobService;
  quarantine: QuarantineService;
  identity: IdentityService;
  accounts: AccountService;
  signals: SignalService;
  signalReviews: ReviewService;
  signalSources: SourceService;
  research: ResearchStack;
  catalogue: CatalogueStack;
}

export function openDatabase(path: string): SqliteDatabase {
  const db = new SqliteDatabase(path);
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  return db;
}

export function buildServices(config: AppConfig, db: SqliteDatabase): Services {
  const jobs = new JobService(db, {
    retry: {
      maxAttempts: config.jobs.maxAttempts,
      baseSeconds: config.jobs.backoffBaseSeconds,
      factor: config.jobs.backoffFactor,
      capSeconds: config.jobs.backoffCapSeconds,
      jitterRatio: 0.2,
    },
    concurrency: config.jobs.concurrency,
    queueDepthCap: config.jobs.queueDepthCap,
  });
  const signals = new SignalService(db, {
    excerptMaxChars: config.signals.excerptMaxChars,
    similarityThreshold: config.signals.similarityThreshold,
    retentionMonths: config.signals.retentionMonths,
  });
  return {
    db,
    identity: new IdentityService(db),
    accounts: new AccountService(db),
    signals,
    signalReviews: new ReviewService(db),
    signalSources: new SourceService(db, config.signals.excerptMaxChars),
    quarantine: new QuarantineService(
      db,
      config.quarantineEncryptionKey ?? "dev-only-quarantine-key-not-for-production-use",
      config.retention.quarantineDays,
    ),
    jobs,
    research: buildResearchStack({ db, config, jobs, signals }),
    catalogue: buildCatalogueStack({ db, config }),
  };
}

async function buildVerifier(config: AppConfig, logger: Logger): Promise<OidcVerifier> {
  if (config.oidc.useFake) {
    // Development and tests only: config refuses USE_FAKE_OIDC in production.
    const { FakeIssuer } = await import("../test-support/fake-oidc/issuer.js");
    const { startFakeOidcServer } = await import("../test-support/fake-oidc/server.js");
    const audience = config.oidc.audience ?? "gtm-engine";
    const issuerUrl = config.oidc.issuerUrl ?? "http://fake-idp.example.org";
    const issuer = await FakeIssuer.create({ issuer: issuerUrl, audience });
    const server = await startFakeOidcServer(issuer, 0);
    logger.warn({ jwksUri: server.jwksUri }, "using the FAKE OIDC issuer (development only)");
    return new OidcVerifier({
      issuer: issuerUrl,
      audience,
      fetchJwks: httpJwksFetcher(server.jwksUri),
    });
  }
  const issuerUrl = config.oidc.issuerUrl!;
  return new OidcVerifier({
    issuer: issuerUrl,
    audience: config.oidc.audience!,
    fetchJwks: httpJwksFetcher(`${issuerUrl.replace(/\/$/, "")}/.well-known/jwks.json`),
  });
}

export async function buildHttpApp(config: AppConfig, logger: Logger, services: Services) {
  const verifier = await buildVerifier(config, logger);
  const authz = createAuthz({
    verifier,
    resolve: (identity, correlationId) =>
      services.identity.resolvePrincipal(identity, correlationId),
    auditDenied: (event) => services.identity.recordDenied(event),
  });
  const notifier = new PhiNotifier();
  return buildServer({
    config,
    logger,
    phiGuardSink: createPhiGuardSink(services.db, notifier),
    routes: (app) => {
      registerIdentityRoutes(app, { db: services.db, service: services.identity, authz });
      registerAuditRoutes(app, { db: services.db, authz });
      registerQuarantineRoutes(app, { db: services.db, service: services.quarantine, authz });
      registerJobRoutes(app, { service: services.jobs, authz });
      registerAccountRoutes(app, {
        db: services.db,
        service: services.accounts,
        authz,
        limits: config.imports,
      });
      registerResearchRoutes(app, {
        db: services.db,
        service: services.research.research,
        schedules: services.research.schedules,
        interpreter: services.research.interpreter,
        rules: services.research.rules,
        authz,
      });
      registerHypothesisRoutes(app, {
        db: services.db,
        service: services.research.hypotheses,
        review: services.research.review,
        authz,
      });
      registerClaimRoutes(app, {
        db: services.db,
        claims: services.catalogue.claims,
        review: services.catalogue.claimReview,
        authz,
      });
      registerOfferRoutes(app, {
        db: services.db,
        offers: services.catalogue.offers,
        status: services.catalogue.offerStatus,
        limitations: services.catalogue.limitations,
        capacity: services.catalogue.capacity,
        bookings: services.catalogue.bookings,
        scores: services.catalogue.scores,
        paidTypes: services.catalogue.paidTypes,
        authz,
      });
      registerCapabilityRoutes(app, {
        db: services.db,
        capabilities: services.catalogue.capabilities,
        authz,
      });
      registerSignalRoutes(app, {
        db: services.db,
        signals: services.signals,
        reviews: services.signalReviews,
        sources: services.signalSources,
        authz,
      });
    },
  });
}
