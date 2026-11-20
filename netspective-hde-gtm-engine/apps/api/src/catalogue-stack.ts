import type { SqliteDatabase } from "@gtm/db";
import type { AppConfig } from "./config/index.js";
import { CapabilityService } from "./modules/capabilities/index.js";
import { ClaimReviewService, ClaimService, ClaimStaleness } from "./modules/claims/index.js";
import {
  BookingService,
  CapacityService,
  OfferLimitations,
  OfferService,
  OfferStatusService,
  PaidTypeService,
  ScoreService,
} from "./modules/offers/index.js";

// Composition of the claims, offers and capabilities services (feature 005, task T065). All settings are
// hypotheses (open question 48). Claims come first: offers and capabilities depend on its public index.

export interface CatalogueStack {
  claims: ClaimService;
  claimReview: ClaimReviewService;
  claimStaleness: ClaimStaleness;
  offers: OfferService;
  offerStatus: OfferStatusService;
  limitations: OfferLimitations;
  capacity: CapacityService;
  bookings: BookingService;
  scores: ScoreService;
  paidTypes: PaidTypeService;
  capabilities: CapabilityService;
}

export function buildCatalogueStack(o: {
  db: SqliteDatabase;
  config: AppConfig;
  now?: () => Date;
}): CatalogueStack {
  const { db, config } = o;
  const settings = { businessTimeZone: config.catalogue.businessTimeZone };
  const claims = new ClaimService(db, {
    evidenceDefaultExpiryMonths: config.catalogue.evidenceDefaultExpiryMonths,
  });
  return {
    claims,
    claimReview: new ClaimReviewService(db, claims),
    claimStaleness: new ClaimStaleness(db),
    offers: new OfferService(db),
    offerStatus: new OfferStatusService(db),
    limitations: new OfferLimitations(db),
    capacity: new CapacityService(db, settings),
    bookings: new BookingService(db, settings),
    scores: new ScoreService(db, {
      scoreMin: config.catalogue.scoreMin,
      scoreMax: config.catalogue.scoreMax,
    }),
    paidTypes: new PaidTypeService(db),
    capabilities: new CapabilityService(db, o.now ? { now: o.now } : {}),
  };
}
