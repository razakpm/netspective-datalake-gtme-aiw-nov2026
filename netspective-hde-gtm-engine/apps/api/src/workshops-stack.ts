import type { SqliteDatabase } from "@gtm/db";
import {
  FakeCalendar,
  FakePdfRenderer,
  GoogleCalendarProvider,
  PlaywrightPdfRenderer,
  type CalendarProvider,
  type FileStorageProvider,
  type PdfRenderer,
} from "@gtm/providers";
import type { CatalogueStack } from "./catalogue-stack.js";
import type { AppConfig } from "./config/index.js";
import type { QuarantineService } from "./modules/audit/index.js";
import type { HypothesisService } from "./modules/hypotheses/index.js";
import type { LlmGateway } from "./modules/providers/index.js";
import {
  ArtifactService,
  BriefService,
  EffortService,
  FindingsService,
  OutputService,
  ParticipantService,
  SuggestService,
  WorkshopRetention,
  WorkshopService,
} from "./modules/workshops/index.js";
import type { PhiNotifier } from "./platform/events/phi-notifier.js";

// Composition of the workshops stack (feature 007). The calendar is chosen from configuration: none (booking
// by hand only, the default), the fake (development and tests; production refuses it) or Google, which also
// needs its switch and credentials.

export function createCalendarProvider(config: AppConfig): CalendarProvider | null {
  if (config.calendar.provider === "fake") return new FakeCalendar();
  if (config.calendar.provider === "google" && config.calendar.google) {
    return new GoogleCalendarProvider(config.calendar.google);
  }
  return null;
}

/** The fake renderer is for development and tests; production refuses it in configuration. */
export function createPdfRenderer(config: AppConfig): PdfRenderer {
  return config.workshops.pdfRenderer === "playwright"
    ? new PlaywrightPdfRenderer()
    : new FakePdfRenderer();
}

export interface WorkshopsStackOptions {
  db: SqliteDatabase;
  config: AppConfig;
  catalogue: CatalogueStack;
  files: FileStorageProvider;
  quarantine: QuarantineService;
  notifier: PhiNotifier;
  gateway: LlmGateway;
  hypotheses: HypothesisService;
  /** The account's monthly model allowance, read the same way research reads it. */
  accountRemaining: (accountId: string) => number;
  /** Overrides the configured PDF renderer (tests). */
  renderer?: PdfRenderer;
  /** Overrides WORKSHOP_AI (tests). */
  ai?: boolean;
  /** Overrides the configured calendar (tests); null means none. */
  calendar?: CalendarProvider | null;
}

export function buildWorkshopsStack(o: WorkshopsStackOptions) {
  const workshops = new WorkshopService(o.db, {
    bookings: o.catalogue.bookings,
    capacity: o.catalogue.capacity,
    calendar: o.calendar === undefined ? createCalendarProvider(o.config) : o.calendar,
    settings: {
      minutes: o.config.workshops.minutes,
      businessTimeZone: o.config.catalogue.businessTimeZone,
    },
  });
  const participants = new ParticipantService(o.db);
  const artifacts = new ArtifactService(o.db, {
    files: o.files,
    quarantine: o.quarantine,
    notifier: o.notifier,
    settings: {
      kinds: o.config.workshops.artifactKinds,
      maxBytes: o.config.workshops.artifactMaxBytes,
      uploadQuarantine: o.config.workshops.uploadQuarantine,
    },
  });
  const model = {
    gateway: o.gateway,
    enabled: o.ai ?? o.config.workshops.ai,
    capMicros: o.config.workshops.aiCapMicros,
    accountRemaining: o.accountRemaining,
  };
  const findings = new FindingsService(o.db);
  const suggest = new SuggestService(o.db, model);
  const briefs = new BriefService(o.db, {
    ...model,
    hypotheses: o.hypotheses,
    artifactKinds: o.config.workshops.artifactKinds,
  });
  const outputs = new OutputService(o.db, {
    files: o.files,
    renderer: o.renderer ?? createPdfRenderer(o.config),
    settings: {
      maxChars: o.config.workshops.outputMaxChars,
      businessTimeZone: o.config.catalogue.businessTimeZone,
    },
  });
  const effort = new EffortService(o.db);
  const retention = new WorkshopRetention(o.db, {
    files: o.files,
    months: o.config.workshops.retentionMonths,
  });
  return {
    workshops,
    participants,
    effort,
    retention,
    outputs,
    findings,
    suggest,
    briefs,
    artifacts,
    artifactMaxBytes: o.config.workshops.artifactMaxBytes,
  };
}

export type WorkshopsStack = ReturnType<typeof buildWorkshopsStack>;
