import type { SqliteDatabase } from "@gtm/db";
import { LocalFileStorage, type FileStorageProvider } from "@gtm/providers";
import type { AppConfig } from "./config/index.js";
import {
  ConsentLookup,
  DeliveryService,
  NoticeService,
  PriorLookup,
  RequestService,
} from "./modules/engagement/index.js";
import type { RoutingStack } from "./routing-stack.js";

// Composition of the engagement stack (feature 006, task T050): notice versions, consent, delivery of the
// register and the public requests. It fills the routing context's ports (consent and prior interactions)
// and hands the recommender port the offers service, so `engagement` and `offers` stay one-way.

export interface EngagementStackOptions {
  db: SqliteDatabase;
  config: AppConfig;
  routing: RoutingStack;
  files?: FileStorageProvider;
  log?: (message: string) => void;
}

export function buildEngagementStack(o: EngagementStackOptions) {
  const r = o.config.routing;
  const files = o.files ?? new LocalFileStorage(r.fileStorageDir, r.downloadSigningKey);
  const notices = new NoticeService(o.db);
  const delivery = new DeliveryService(files, {
    registerFileKey: r.registerFileKey,
    linkTtlHours: r.registerLinkTtlHours,
  });
  const requests = new RequestService(o.db, {
    contacts: o.routing.contacts,
    icp: o.routing.icp,
    notices,
    delivery,
    settings: {
      formTokenKey: r.formTokenKey,
      minSeconds: r.formMinSeconds,
      maxAgeHours: r.formMaxAgeHours,
      dedupeSeconds: r.dedupeSeconds,
    },
    ...(o.log ? { log: o.log } : {}),
  });
  requests.setRecommender(o.routing.recommendations);
  const consent = new ConsentLookup(o.db);
  o.routing.ports.wire({ prior: new PriorLookup(o.db), consent });
  return { files, notices, delivery, requests, consent };
}

export type EngagementStack = ReturnType<typeof buildEngagementStack>;
