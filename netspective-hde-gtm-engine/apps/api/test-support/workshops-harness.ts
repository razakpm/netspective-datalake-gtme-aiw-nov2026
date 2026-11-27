import { DEFAULT_ARTIFACT_KINDS, FOUNDATION_ROLE_PERMISSIONS, type guardValue } from "@gtm/domain";
import { FakeCalendar, FakePdfRenderer } from "@gtm/providers";
import { QuarantineService } from "../src/modules/audit/index.js";
import {
  DeliveryService,
  NoticeService,
  RequestService,
  signFormToken,
  type FormSlug,
} from "../src/modules/engagement/index.js";
import {
  ArtifactService,
  BriefService,
  EffortService,
  FindingsService,
  IntakeRules,
  OutputService,
  ParticipantService,
  SuggestService,
  WorkshopRetention,
  WorkshopService,
} from "../src/modules/workshops/index.js";
import { PhiNotifier } from "../src/platform/events/phi-notifier.js";
import { PEOPLE } from "./catalogue-harness.js";
import { buildOffersHarness, type OffersHarnessOptions } from "./offers-harness.js";

// A workshops stack on an in-memory database with all migrations and seeds, a fake clock, fake providers
// and actors (feature 007 tests, task T020). It builds on the offers harness and the real request service,
// so a workshop is always made from a request that went through the public form and was linked.

export const FORM_KEY = "f".repeat(32);
export const QUARANTINE_KEY = "quarantine-test-key-0123456789abcdef-not-real";

/** Ten synthetic field names, the same as tests/fixtures/workshops/findings-cases.json. */
export const FIELD_NAMES = [
  "encounter_start_time",
  "discharge_disposition",
  "primary_payer_type",
  "lab_result_code",
  "lab_result_unit",
  "medication_code",
  "problem_list_status",
  "provider_specialty",
  "facility_identifier_type",
  "referral_reason_text",
];

const INTAKES = {
  1: {
    slug: "sender-onboarding-friction-map" as FormSlug,
    org: "northvale" as const,
    intake: {
      programType: "health_information_exchange",
      organisationName: "Northvale HIE",
      recentOnboarding: {
        senderLabel: "Synthetic sender A",
        formatAndGuide: "HL7 v2 results with the exchange implementation guide",
        timelineAndStages: "Registration, testing, rejection review, production",
      },
      knownDelays: ["Rejections wait for a manual review"],
      attendingRoles: ["Integration lead"],
      specsAvailable: "yes",
      scrubbedRejectionLogsAvailable: "unsure",
    },
  },
  6: {
    slug: "pilot-input-trace-workshop" as FormSlug,
    org: "riverbend" as const,
    intake: {
      useCase: "Readmission risk pilot",
      pilotOwner: "Clinical informatics lead",
      sourceSystems: ["Synthetic clinical system", "Synthetic laboratory system"],
      fieldNames: FIELD_NAMES,
      dataLead: "Integration lead",
      attendees: ["Integration lead", "Pilot owner"],
    },
  },
};

export interface WorkshopsHarnessOptions extends OffersHarnessOptions {
  /** null: no calendar is configured. Default: the fake calendar. */
  calendar?: null | undefined;
  uploadQuarantine?: boolean;
  /** Switch the model on (off by default, as in configuration). */
  workshopAi?: boolean;
  /** Per call cost cap of the workshop model calls. */
  workshopCapMicros?: number;
  /** The account's monthly allowance. */
  monthlyCapMicros?: number;
  /** The one-page character budget. */
  outputMaxChars?: number;
  /** Replaces the boundary guard the artifact service runs. */
  guard?: typeof guardValue;
}

export function buildWorkshopsHarness(options: WorkshopsHarnessOptions = {}) {
  const base = buildOffersHarness(options);
  const { db, now } = base;
  const notices = new NoticeService(db);
  const delivery = new DeliveryService(base.files, {
    registerFileKey: "register.pdf",
    linkTtlHours: 24,
  });
  const requests = new RequestService(db, {
    contacts: base.contacts,
    icp: base.icp,
    notices,
    delivery,
    settings: { formTokenKey: FORM_KEY, minSeconds: 0, maxAgeHours: 24, dedupeSeconds: 0 },
  });
  requests.setIntakeValidator(new IntakeRules());
  const quarantine = new QuarantineService(db, QUARANTINE_KEY, 30, now);

  const calendar = new FakeCalendar();
  const workshops = new WorkshopService(db, {
    bookings: base.bookings,
    capacity: base.capacity,
    calendar: options.calendar === null ? null : calendar,
    settings: {
      minutes: { offer1: 45, offer6: 90 },
      businessTimeZone: base.businessTimeZone,
    },
  });
  const participants = new ParticipantService(db);
  const notifier = new PhiNotifier(60_000, now);
  const artifacts = new ArtifactService(db, {
    files: base.files,
    quarantine,
    notifier,
    settings: {
      kinds: [...DEFAULT_ARTIFACT_KINDS],
      maxBytes: 1_048_576,
      uploadQuarantine: options.uploadQuarantine ?? true,
    },
    guard: options.guard,
  });
  const findings = new FindingsService(db);
  const model = {
    gateway: base.gateway,
    enabled: options.workshopAi ?? false,
    capMicros: options.workshopCapMicros ?? 200_000,
    accountRemaining: (accountId: string) => {
      const spent = db.raw
        .prepare("SELECT COALESCE(SUM(cost_micros), 0) c FROM ai_invocation WHERE account_id = ?")
        .get(accountId) as { c: number };
      return (options.monthlyCapMicros ?? 20_000_000) - spent.c;
    },
  };
  const suggest = new SuggestService(db, model);
  const briefs = new BriefService(db, {
    ...model,
    hypotheses: base.hypotheses,
    artifactKinds: [...DEFAULT_ARTIFACT_KINDS],
  });
  const effort = new EffortService(db);
  const retention = new WorkshopRetention(db, { files: base.files, months: 12, now });
  const renderer = new FakePdfRenderer();
  const outputs = new OutputService(db, {
    files: base.files,
    renderer,
    settings: {
      maxChars: options.outputMaxChars ?? 3500,
      businessTimeZone: base.businessTimeZone,
    },
  });
  /** A workshop that has been converted, booked and held. */
  const heldWorkshop = async (offer: 1 | 6) => {
    const made = workshops.convert(operator(), (await linkedIntake(offer)).requestId);
    await workshops.transition(operator(), made.id, {
      action: "book",
      lockNo: 1,
      scheduledAt: now().toISOString(),
    });
    return workshops.transition(operator(), made.id, { action: "hold", lockNo: 2 });
  };
  // Quarantine decisions are recorded against a user row.
  for (const person of Object.values(PEOPLE)) {
    db.raw
      .prepare(
        `INSERT OR IGNORE INTO "user" (id, email, status, idp_subject, created_at) VALUES (?, ?, 'active', ?, ?)`,
      )
      .run(person.userId, `${person.userId}@example.org`, person.userId, now().toISOString());
  }

  const operator = () => base.actor("operator");
  const lead = () => base.actor("lead");
  const reader = () => base.actor("executive");
  const analyst = () => base.actor("analyst");
  const administrator = () => base.actor("admin");
  /** An automated actor holding every operator permission: it must still never move anything. */
  const automated = (actorType: "ai" | "system") => ({
    userId: "automated-1",
    actorType,
    correlationId: "corr-test",
    permissions: FOUNDATION_ROLE_PERMISSIONS.administrator,
    now,
  });

  const created = new Set<string>();
  let notice: string | undefined;
  let submissions = 0;

  /** The account of an intake, made once. */
  const account = (offer: 1 | 6) => {
    const key = INTAKES[offer].org;
    if (!created.has(key)) {
      base.org(key);
      created.add(key);
    }
    return base.ORGS[key];
  };

  /** A request from the public intake form that nobody has reviewed or linked. */
  const submitIntake = async (offer: 1 | 6) => {
    const spec = INTAKES[offer];
    const org = account(offer);
    notice ??= base.approveNotice();
    submissions += 1;
    const receipt = await requests.submit(
      spec.slug,
      {
        kind: "intake",
        formToken: signFormToken(FORM_KEY, spec.slug, now()),
        noticeVersionId: notice,
        consentToContact: true,
        website: "",
        contact: {
          email: `contact${submissions}@${org.domain}`,
          role: "Integration Lead",
          orgName: org.name,
          orgType: org.type,
        },
        intake: spec.intake,
      },
      { now: now(), correlationId: "corr-test" },
    );
    return receipt.requestId;
  };

  /** A reviewed and linked intake request, ready to convert. */
  const linkedIntake = async (offer: 1 | 6) => {
    const requestId = await submitIntake(offer);
    const detail = requests.review(operator(), requestId, { action: "link" });
    return {
      requestId,
      offerId: base.offerId(offer),
      accountId: detail.accountId as string,
      contactId: detail.contactId as string,
    };
  };

  return {
    ...base,
    notices,
    requests,
    quarantine,
    calendar,
    workshops,
    participants,
    artifacts,
    notifier,
    findings,
    model,
    suggest,
    briefs,
    renderer,
    outputs,
    effort,
    retention,
    heldWorkshop,
    operator,
    lead,
    reader,
    analyst,
    administrator,
    automated,
    account,
    submitIntake,
    linkedIntake,
  };
}

export type WorkshopsHarness = ReturnType<typeof buildWorkshopsHarness>;
