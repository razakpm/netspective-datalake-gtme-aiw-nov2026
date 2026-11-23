import type { SqliteDatabase, Tx } from "@gtm/db";
import { type ActorType } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { HttpError, parseOrThrow } from "../../http/errors.js";
import {
  audited,
  CatalogueRefusal,
  guardFreeText,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { resolveAccountForForm } from "../accounts/index.js";
import { recordAudit } from "../audit/index.js";
import { checkSuppression, type ContactsService } from "../contacts/index.js";
import type { IcpService } from "../icp/index.js";
import type { Recommender } from "../offers/index.js";
import { checkFormToken, honeypotFilled } from "./abuse.js";
import { recordConsent } from "./consent.js";
import { DOWNLOAD_PATH, type DeliveryService } from "./delivery.js";
import { emitLeadMagnetDownloaded, emitOfferRequested } from "./events.js";
import type { NoticeService } from "./notice.js";
import { FORM_ORG_TYPES, FORMS, type FormSlug, type RequestKind } from "./public-forms.js";

// Requests from the public forms (feature 006, spec FR-016 to FR-024, FR-028, FR-029). A submission is
// checked, resolved to an account and contact, recorded with the consent the person gave against the notice
// version they saw, and (for a download) delivered as an expiring link. Nothing is ever sent, and a
// download is first-party engagement: it is never intent and never a qualified lead.

export interface RequestSettings {
  formTokenKey: string;
  minSeconds: number;
  maxAgeHours: number;
  dedupeSeconds: number;
}

/** The typed, validated intake for Offers 1 and 6 (feature 006 US5 and US6), written by `workshops`. */
export interface IntakeValidator {
  validate(
    slug: string,
    payload: unknown,
  ):
    | { ok: true; kind: "offer_1" | "offer_6"; schemaVersion: number; payload: unknown }
    | { ok: false; messages: string[] };
}

const orgTypeKeys = FORM_ORG_TYPES.map((t) => t.key) as [string, ...string[]];
const ContactSchema = z
  .object({
    email: z.string().min(3).max(254),
    displayName: z.string().max(120).optional(),
    role: z.string().min(2).max(120),
    orgName: z.string().min(2).max(200),
    orgType: z.enum(orgTypeKeys),
  })
  .strict();
const CommonShape = {
  formToken: z.string().min(1).max(500),
  noticeVersionId: z.string().min(1).max(100),
  consentToContact: z.boolean().optional(),
  website: z.string().max(500).optional(),
  contact: ContactSchema,
};
export const PublicRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("download"), ...CommonShape }).strict(),
  z
    .object({
      kind: z.literal("working_session"),
      ...CommonShape,
      decisions: z.array(z.string()).max(20),
    })
    .strict(),
  z.object({ kind: z.literal("intake"), ...CommonShape, intake: z.unknown() }).strict(),
]);
export type PublicRequest = z.infer<typeof PublicRequestSchema>;

interface RequestRow {
  id: string;
  offer_id: string;
  form_slug: string;
  kind: RequestKind;
  state: "received" | "reviewed" | "linked" | "closed";
  email: string | null;
  display_name: string | null;
  role_title: string | null;
  org_name: string | null;
  org_type: string | null;
  account_id: string | null;
  contact_id: string | null;
  flags_json: string;
  details_json: string | null;
  submitted_at: string;
}

export interface RequestSummary {
  id: string;
  kind: RequestKind;
  offerId: string;
  state: RequestRow["state"];
  email: string | null;
  displayName: string | null;
  orgName: string | null;
  accountId: string | null;
  contactId: string | null;
  flags: RequestFlag[];
  submittedAt: string;
}
export interface RequestDetail extends RequestSummary {
  roleTitle: string | null;
  orgType: string | null;
  consent: { noticeVersionId: string; consentGiven: boolean; recordedAt: string };
  download: {
    delivered: boolean;
    deliveryFailure: string | null;
    linkExpiresAt: string | null;
  } | null;
  decisions: string[] | null;
  intake: unknown;
  recommendationId: string | null;
}
export interface ConversionRow {
  contactId: string | null;
  downloads: number;
  sessionRequests: number;
  sessionAfterDownload: boolean;
}

const summaryOf = (r: RequestRow): RequestSummary => ({
  id: r.id,
  kind: r.kind,
  offerId: r.offer_id,
  state: r.state,
  email: r.email,
  displayName: r.display_name,
  orgName: r.org_name,
  accountId: r.account_id,
  contactId: r.contact_id,
  flags: JSON.parse(r.flags_json) as RequestFlag[],
  submittedAt: r.submitted_at,
});

export const ReviewSchema = z
  .object({
    action: z.enum(["mark_reviewed", "link", "close"]),
    accountId: z.string().min(1).optional(),
    contactId: z.string().min(1).optional(),
    businessEmail: z.string().max(254).optional(),
    reason: z.string().min(3).max(300).optional(),
  })
  .strict();

export type RequestFlag = "personal_email" | "org_type_differs" | "suppressed" | "no_consent";

export interface Receipt {
  requestId: string;
  status: "received";
  flags: "personal_email"[];
  download?: { url: string | null; expiresAt: string | null; delivered: boolean };
}

interface Ctx {
  correlationId: string | null;
  now: Date;
}

const rejected = (reason: string, log?: (m: string) => void): never => {
  log?.(reason);
  throw new HttpError(
    400,
    "Form not accepted",
    "The form could not be accepted. Please reload the page and try again.",
    { codes: ["form_rejected"] },
  );
};

export class RequestService {
  private recommender: Recommender | null = null;
  private intake: IntakeValidator | null = null;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly d: {
      contacts: ContactsService;
      icp: IcpService;
      notices: NoticeService;
      delivery: DeliveryService;
      settings: RequestSettings;
      log?: (message: string) => void;
    },
  ) {}

  /** The recommender is wired at the composition root, so `engagement` never imports `offers` internals. */
  setRecommender(recommender: Recommender): void {
    this.recommender = recommender;
  }
  setIntakeValidator(validator: IntakeValidator): void {
    this.intake = validator;
  }

  // ---- public side -------------------------------------------------------------------------------

  formFor(slug: FormSlug, now: Date, signToken: (slug: string, at: Date) => string) {
    const notice = this.d.notices.currentApproved();
    if (!notice) {
      throw new HttpError(
        503,
        "Form not available",
        "This form is not available yet. Please try again later.",
        { codes: ["no_notice"] },
      );
    }
    const spec = FORMS[slug];
    return {
      slug,
      title: spec.title,
      kinds: spec.kinds,
      orgTypes: FORM_ORG_TYPES,
      notice: {
        versionId: notice.id,
        noticeText: notice.noticeText,
        consentText: notice.consentText,
      },
      formToken: signToken(slug, now),
      issuedAt: now.toISOString(),
    };
  }

  async submit(slug: FormSlug, raw: unknown, ctx: Ctx): Promise<Receipt> {
    const body = parseOrThrow(PublicRequestSchema, raw);
    const spec = FORMS[slug];
    if (!spec.kinds.includes(body.kind as RequestKind)) {
      throw new HttpError(
        400,
        "Request not available",
        "This form does not take that kind of request.",
        {
          codes: ["kind_not_available"],
        },
      );
    }
    const notice = this.d.notices.approvedById(body.noticeVersionId);
    if (!notice) {
      if (!this.d.notices.currentApproved()) {
        throw new HttpError(
          503,
          "Form not available",
          "This form is not available yet. Please try again later.",
          { codes: ["no_notice"] },
        );
      }
      throw new HttpError(
        409,
        "The notice changed",
        "The privacy notice was updated. Please reload the page and read it again.",
        { codes: ["notice_changed"] },
      );
    }
    if (honeypotFilled(body.website)) rejected("honeypot", this.d.log);
    const token = checkFormToken(this.d.settings.formTokenKey, body.formToken, slug, ctx.now, {
      minSeconds: this.d.settings.minSeconds,
      maxAgeHours: this.d.settings.maxAgeHours,
    });
    if (!token.ok) rejected(`token_${token.reason}`, this.d.log);

    // Typed content per kind (a working session's decisions, an intake's fields).
    let details: Record<string, unknown> | null = null;
    let intake: { kind: "offer_1" | "offer_6"; schemaVersion: number; payload: unknown } | null =
      null;
    const typed = this.typedContent(slug, body);
    if ("refuse" in typed) throw typed.refuse;
    details = typed.details;
    intake = typed.intake;

    const email = body.contact.email.trim().toLowerCase();
    const emailHash = this.d.contacts.emailHash(email);

    // A repeated submission by the same person within the window creates nothing new.
    const dup = this.recent(emailHash, slug, body.kind, ctx.now);
    if (dup) return dup;

    const delivery = body.kind === "download" ? await this.d.delivery.prepare(ctx.now) : null;
    const consentGiven = body.consentToContact === true;
    const offer = this.db.raw.prepare("SELECT id FROM engagement_offer WHERE key = ?").get(slug) as
      { id: string } | undefined;
    if (!offer) throw new HttpError(404, "Not found");
    const actor = {
      actorId: null,
      actorType: "system" as ActorType,
      correlationId: ctx.correlationId,
      now: () => ctx.now,
    };

    const outcome = this.db.transaction((tx) => {
      const id = uuidv7();
      const at = ctx.now.toISOString();
      const flags: RequestFlag[] = [];
      let accountId: string | null = null;
      let contactId: string | null = null;
      let suppressed: boolean;

      const domain = email.split("@")[1] ?? "";
      const personal = this.d.contacts.personalDomains(tx).has(domain);
      if (personal) {
        flags.push("personal_email");
        suppressed = checkSuppression(tx, { emailHash }).suppressed;
      } else {
        const account = resolveAccountForForm(
          tx,
          { domain, orgName: body.contact.orgName, orgType: body.contact.orgType },
          actor,
        );
        accountId = account.accountId;
        if (account.orgTypeDiffers) flags.push("org_type_differs");
        const contact = this.d.contacts.findOrCreateByBusinessEmail(
          tx,
          {
            email,
            role: body.contact.role,
            accountId: account.accountId,
            source: "first_party_form",
            basis: consentGiven ? "consent" : "service_related",
            documentedOrigin: `Public form ${slug}`,
          },
          actor,
        );
        if (!contact.ok)
          throw new HttpError(400, "Email not accepted", "Please give a work email address.", {
            codes: [contact.code],
          });
        contactId = contact.contactId;
        // An account reached for the first time, or one never assessed, gets its fit assessed by rule.
        if (account.created || this.d.icp.currentFit(account.accountId, tx).icp === null) {
          this.d.icp.assess(tx, account.accountId, actor);
        }
        suppressed = checkSuppression(tx, { contactId, accountId, emailHash }).suppressed;
      }
      if (suppressed) flags.push("suppressed");
      if (!consentGiven) flags.push("no_consent");

      tx.prepare(
        `INSERT INTO offer_request (id, offer_id, form_slug, kind, state, email, email_hash, display_name, role_title,
           org_name, org_type, account_id, contact_id, flags_json, details_json, submitted_at)
         VALUES (?,?,?,?, 'received', ?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        offer.id,
        slug,
        body.kind,
        email,
        emailHash,
        body.contact.displayName ?? null,
        body.contact.role,
        body.contact.orgName,
        body.contact.orgType,
        accountId,
        contactId,
        JSON.stringify(flags),
        details ? JSON.stringify(details) : null,
        at,
      );
      recordConsent(tx, {
        requestId: id,
        contactId,
        emailHash,
        noticeVersionId: notice.id,
        consentGiven,
        at,
      });

      let downloadId: string | null = null;
      if (delivery) {
        downloadId = uuidv7();
        tx.prepare(
          `INSERT INTO lead_magnet_download (id, request_id, offer_id, account_id, contact_id, delivered, delivery_failure, link_expires_at, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run(
          downloadId,
          id,
          offer.id,
          accountId,
          contactId,
          delivery.delivered ? 1 : 0,
          delivery.delivered ? null : delivery.failure,
          delivery.delivered ? delivery.expiresAt.toISOString() : null,
          at,
        );
      }
      if (intake) {
        tx.prepare(
          `INSERT INTO intake_submission (id, request_id, offer_id, kind, schema_version, account_id, contact_id,
             payload_json, classification, submitted_at)
           VALUES (?,?,?,?,?,?,?,?, 'non_phi', ?)`,
        ).run(
          uuidv7(),
          id,
          offer.id,
          intake.kind,
          intake.schemaVersion,
          accountId,
          contactId,
          JSON.stringify(intake.payload),
          at,
        );
      }
      recordAudit(
        tx,
        {
          actorId: null,
          actorType: "system",
          action: "offer_request.receive",
          entityType: "offer_request",
          entityId: id,
          outcome: "success",
          after: { kind: body.kind, slug, flags, notice_version: notice.version },
          correlationId: ctx.correlationId,
        },
        () => ctx.now,
      );
      const ev = {
        actorId: null,
        actorType: "system" as ActorType,
        correlationId: ctx.correlationId,
        now: () => ctx.now,
      };
      emitOfferRequested(tx, ev, { requestId: id, offerId: offer.id, kind: body.kind });
      if (downloadId && delivery) {
        emitLeadMagnetDownloaded(tx, ev, {
          downloadId,
          requestId: id,
          delivered: delivery.delivered,
        });
      }
      return { id, flags, accountId, contactId, suppressed };
    });

    // Follow-up: a person reviews it. Only a download from a business contact who is not suppressed.
    // A failed delivery waits for a person, so no follow-up is queued for it.
    if (
      body.kind === "download" &&
      delivery?.delivered === true &&
      outcome.accountId &&
      !outcome.suppressed &&
      this.recommender
    ) {
      try {
        await this.recommender.recommendForRequest({
          accountId: outcome.accountId,
          contactId: outcome.contactId,
          requestId: outcome.id,
          correlationId: ctx.correlationId,
        });
      } catch (error) {
        // The download is already recorded; a failed follow-up is retried by a person from the inbox.
        this.d.log?.(`follow-up recommendation failed: ${(error as Error).message}`);
      }
    }
    return {
      requestId: outcome.id,
      status: "received",
      flags: outcome.flags.includes("personal_email") ? ["personal_email"] : [],
      ...(delivery
        ? {
            download: {
              url: delivery.delivered ? `${DOWNLOAD_PATH}${delivery.token}` : null,
              expiresAt: delivery.delivered ? delivery.expiresAt.toISOString() : null,
              delivered: delivery.delivered,
            },
          }
        : {}),
    };
  }

  /** Typed content for the kind. Working sessions and intakes are added with their stories. */
  private typedContent(
    slug: FormSlug,
    body: PublicRequest,
  ):
    | {
        details: Record<string, unknown> | null;
        intake: { kind: "offer_1" | "offer_6"; schemaVersion: number; payload: unknown } | null;
      }
    | { refuse: HttpError } {
    if (body.kind === "download") return { details: null, intake: null };
    if (body.kind === "working_session") {
      const decisions = body.decisions.map((d) => d.trim());
      if (
        decisions.length < 1 ||
        decisions.length > 5 ||
        decisions.some((d) => d.length < 3 || d.length > 300)
      ) {
        return {
          refuse: new HttpError(
            422,
            "Decisions not accepted",
            "Please list between one and five open decisions, each up to 300 characters.",
            { codes: ["decisions_invalid"] },
          ),
        };
      }
      return { details: { decisions }, intake: null };
    }
    const result = this.intake?.validate(slug, body.intake);
    if (!result || !result.ok) {
      return {
        refuse: new HttpError(
          422,
          "Intake not accepted",
          result && !result.ok ? result.messages.join(" ") : "This intake form is not available.",
          { codes: ["intake_invalid"] },
        ),
      };
    }
    return {
      details: null,
      intake: { kind: result.kind, schemaVersion: result.schemaVersion, payload: result.payload },
    };
  }

  // ---- operator side -----------------------------------------------------------------------------

  list(
    actor: CatalogueActor,
    filter: {
      state?: string | undefined;
      kind?: string | undefined;
      flag?: string | undefined;
    } = {},
  ): RequestSummary[] {
    return audited(this.db, actor, "offer_request.read.refused", "offer_request", null, () => {
      requirePermission(actor, "requests.read");
      const where = ["1=1"];
      const args: string[] = [];
      if (filter.state) {
        where.push("state = ?");
        args.push(filter.state);
      }
      if (filter.kind) {
        where.push("kind = ?");
        args.push(filter.kind);
      }
      if (filter.flag) {
        where.push("flags_json LIKE ?");
        args.push(`%"${filter.flag.replace(/[^a-z_]/g, "")}"%`);
      }
      return (
        this.db.raw
          .prepare(
            `SELECT * FROM offer_request WHERE ${where.join(" AND ")} ORDER BY submitted_at DESC, rowid DESC`,
          )
          .all(...args) as unknown as RequestRow[]
      ).map(summaryOf);
    });
  }

  get(actor: CatalogueActor, id: string): RequestDetail {
    return audited(this.db, actor, "offer_request.read.refused", "offer_request", id, () => {
      requirePermission(actor, "requests.read");
      const r = this.row(this.db.raw, id);
      if (!r) throw new CatalogueRefusal(404, "Not found", ["unknown_request"]);
      return this.detail(r);
    });
  }

  private row(tx: Tx, id: string): RequestRow | undefined {
    return tx.prepare("SELECT * FROM offer_request WHERE id = ?").get(id) as RequestRow | undefined;
  }

  private detail(r: RequestRow): RequestDetail {
    const consent = this.db.raw
      .prepare(
        "SELECT notice_version_id, consent_given, recorded_at FROM consent_record WHERE request_id = ? ORDER BY rowid LIMIT 1",
      )
      .get(r.id) as { notice_version_id: string; consent_given: number; recorded_at: string };
    const dl = this.db.raw
      .prepare(
        "SELECT delivered, delivery_failure, link_expires_at FROM lead_magnet_download WHERE request_id = ?",
      )
      .get(r.id) as
      | { delivered: number; delivery_failure: string | null; link_expires_at: string | null }
      | undefined;
    const intake = this.db.raw
      .prepare("SELECT payload_json FROM intake_submission WHERE request_id = ?")
      .get(r.id) as { payload_json: string } | undefined;
    const rec = this.db.raw
      .prepare(
        "SELECT id FROM offer_recommendation WHERE request_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(r.id) as { id: string } | undefined;
    const details = r.details_json
      ? (JSON.parse(r.details_json) as { decisions?: string[] })
      : null;
    return {
      ...summaryOf(r),
      roleTitle: r.role_title,
      orgType: r.org_type,
      consent: {
        noticeVersionId: consent.notice_version_id,
        consentGiven: consent.consent_given === 1,
        recordedAt: consent.recorded_at,
      },
      download: dl
        ? {
            delivered: dl.delivered === 1,
            deliveryFailure: dl.delivery_failure,
            linkExpiresAt: dl.link_expires_at,
          }
        : null,
      decisions: details?.decisions ?? null,
      intake: intake ? (JSON.parse(intake.payload_json) as unknown) : null,
      recommendationId: rec?.id ?? null,
    };
  }

  review(actor: CatalogueActor, id: string, raw: unknown): RequestDetail {
    const input = parseOrThrow(ReviewSchema, raw);
    return audited(this.db, actor, "offer_request.review.refused", "offer_request", id, () => {
      requirePermission(actor, "requests.review");
      if (input.reason) guardFreeText({ reason: input.reason });
      const at = nowOf(actor).toISOString();
      const write = {
        actorId: actor.userId,
        actorType: actor.actorType,
        correlationId: actor.correlationId,
        now: actor.now,
      };
      this.db.transaction((tx) => {
        const r = this.row(tx, id);
        if (!r) throw new CatalogueRefusal(404, "Not found", ["unknown_request"]);
        if (r.state === "linked" || r.state === "closed") {
          throw new CatalogueRefusal(
            409,
            "Conflict",
            ["request_closed"],
            [],
            "This request has already been linked or closed.",
          );
        }
        if (input.action === "mark_reviewed") {
          if (r.state !== "received")
            throw new CatalogueRefusal(409, "Conflict", ["already_reviewed"]);
          tx.prepare(
            "UPDATE offer_request SET state = 'reviewed', reviewed_by = ?, reviewed_at = ? WHERE id = ?",
          ).run(actor.userId as string, at, id);
        } else if (input.action === "close") {
          if (!input.reason)
            throw new CatalogueRefusal(
              400,
              "Reason needed",
              ["reason_required"],
              [],
              "Closing a request needs a reason.",
            );
          tx.prepare(
            "UPDATE offer_request SET state = 'closed', reviewed_by = ?, reviewed_at = ?, closed_reason = ? WHERE id = ?",
          ).run(actor.userId as string, at, input.reason, id);
        } else {
          const accountId = input.accountId ?? r.account_id;
          let contactId = input.contactId ?? r.contact_id;
          if (!accountId)
            throw new CatalogueRefusal(
              400,
              "Account needed",
              ["account_required"],
              [],
              "Choose the account to link this request to.",
            );
          if (!tx.prepare("SELECT 1 FROM account WHERE id = ?").get(accountId)) {
            throw new CatalogueRefusal(404, "Not found", ["unknown_account"]);
          }
          if (input.businessEmail) {
            const consent = tx
              .prepare(
                "SELECT notice_version_id, consent_given FROM consent_record WHERE request_id = ? ORDER BY rowid LIMIT 1",
              )
              .get(id) as { notice_version_id: string; consent_given: number };
            const made = this.d.contacts.findOrCreateByBusinessEmail(
              tx,
              {
                email: input.businessEmail,
                role: r.role_title ?? "",
                accountId,
                source: "first_party_form",
                basis: consent.consent_given === 1 ? "consent" : "service_related",
                documentedOrigin: `Reviewed request ${r.form_slug}`,
              },
              write,
            );
            if (!made.ok) {
              throw new CatalogueRefusal(
                400,
                made.code === "personal_email" ? "Business email needed" : "Email not accepted",
                [made.code === "personal_email" ? "personal_email_not_business" : made.code],
                [],
                "Give a business email address, not a personal one.",
              );
            }
            contactId = made.contactId;
            recordConsent(tx, {
              requestId: id,
              contactId,
              emailHash: made.emailHash,
              noticeVersionId: consent.notice_version_id,
              consentGiven: consent.consent_given === 1,
              at,
            });
          } else if (!contactId) {
            throw new CatalogueRefusal(
              400,
              "Business email needed",
              ["business_email_required"],
              [],
              "A personal-email request needs a business email before it can be linked to a contact.",
            );
          } else if (!tx.prepare("SELECT 1 FROM contact WHERE id = ?").get(contactId)) {
            throw new CatalogueRefusal(404, "Not found", ["unknown_contact"]);
          }
          tx.prepare(
            "UPDATE offer_request SET state = 'linked', account_id = ?, contact_id = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
          ).run(accountId, contactId, actor.userId as string, at, id);
        }
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "offer_request.review",
            entityType: "offer_request",
            entityId: id,
            outcome: "success",
            after: { action: input.action },
            correlationId: actor.correlationId,
          },
          actor.now,
        );
      });
      return this.detail(this.row(this.db.raw, id)!);
    });
  }

  /** Per person (contact, else email hash): their downloads and later session requests, from the records alone. */
  conversion(actor: CatalogueActor): ConversionRow[] {
    return audited(this.db, actor, "offer_request.read.refused", "offer_request", null, () => {
      requirePermission(actor, "requests.read");
      const rows = this.db.raw
        .prepare(
          `SELECT COALESCE(contact_id, email_hash) AS person, contact_id,
             SUM(CASE WHEN kind = 'download' THEN 1 ELSE 0 END) AS downloads,
             SUM(CASE WHEN kind = 'working_session' THEN 1 ELSE 0 END) AS sessions,
             MIN(CASE WHEN kind = 'download' THEN submitted_at END) AS first_download,
             MIN(CASE WHEN kind = 'working_session' THEN submitted_at END) AS first_session
           FROM offer_request WHERE kind IN ('download','working_session') GROUP BY person ORDER BY person`,
        )
        .all() as {
        person: string;
        contact_id: string | null;
        downloads: number;
        sessions: number;
        first_download: string | null;
        first_session: string | null;
      }[];
      return rows.map((r) => ({
        contactId: r.contact_id,
        downloads: r.downloads,
        sessionRequests: r.sessions,
        sessionAfterDownload:
          r.first_download !== null &&
          r.first_session !== null &&
          r.first_session >= r.first_download,
      }));
    });
  }

  private recent(emailHash: string, slug: string, kind: string, now: Date): Receipt | null {
    const since = new Date(now.getTime() - this.d.settings.dedupeSeconds * 1000).toISOString();
    const row = this.db.raw
      .prepare(
        `SELECT id, flags_json FROM offer_request WHERE email_hash = ? AND form_slug = ? AND kind = ? AND submitted_at >= ?
         ORDER BY submitted_at DESC LIMIT 1`,
      )
      .get(emailHash, slug, kind, since) as { id: string; flags_json: string } | undefined;
    if (!row) return null;
    const flags = JSON.parse(row.flags_json) as RequestFlag[];
    const dl = this.db.raw
      .prepare("SELECT delivered, link_expires_at FROM lead_magnet_download WHERE request_id = ?")
      .get(row.id) as { delivered: number; link_expires_at: string | null } | undefined;
    return {
      requestId: row.id,
      status: "received",
      flags: flags.includes("personal_email") ? ["personal_email"] : [],
      ...(dl
        ? {
            download: {
              url:
                dl.delivered === 1 && dl.link_expires_at
                  ? `${DOWNLOAD_PATH}${this.d.delivery.relink(new Date(dl.link_expires_at))}`
                  : null,
              expiresAt: dl.link_expires_at,
              delivered: dl.delivered === 1,
            },
          }
        : {}),
    };
  }
}
