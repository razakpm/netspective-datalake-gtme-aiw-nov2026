import type { SqliteDatabase, Tx } from "@gtm/db";
import { hasPermission } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { parseOrThrow } from "../../http/errors.js";
import {
  audited,
  CatalogueRefusal,
  guardFreeText,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { recordAudit } from "../audit/index.js";
import { effectiveStatus, getClaim, listEvidence as listClaimEvidence } from "../claims/index.js";
import { emitCapabilityUpdated } from "./events.js";
import { toPublicCapability, type PublicCapability } from "./projection.js";
import {
  capabilityIdsFor,
  getCapability,
  insertEvidence,
  insertExample,
  link,
  listCapabilities,
  listEvidence,
  listExamples,
  offerExists,
  offerIdsFor,
  offerName,
  paidTypeExists,
  setPublicStatus,
  unlink,
  updateAttributes,
  type AttributeChange,
  type CapabilityRow,
  type EvidenceRow,
  type ExampleRow,
} from "./repository.js";

// The capability catalogue (feature 005, task T046): 19 slots, attributes that are null until provided,
// evidence, internal-only delivery examples, offer links and the gate on public-claim approval.

const text = (max: number) => z.string().min(1).max(max);
const AttributesSchema = z
  .object({
    name: text(200).nullable(),
    description: text(1000).nullable(),
    inputTypes: z.array(text(120)).max(30).nullable(),
    outputTypes: z.array(text(120)).max(30).nullable(),
    buyerProblems: z.array(text(300)).max(30).nullable(),
    limitations: z.array(text(300)).max(30).nullable(),
    requiredExpertise: text(300).nullable(),
    potentialPaidTypeKey: text(100).nullable(),
  })
  .partial()
  .strict();
export const CapabilityChangeSchema = z
  .object({ lockNo: z.number().int().min(1), attributes: AttributesSchema })
  .strict();
export const EvidenceInputSchema = z
  .object({
    basisKind: z.enum(["delivery_record", "published_material", "internal_assessment"]),
    reference: z.string().min(3).max(300),
    note: z.string().min(3).max(300).optional(),
  })
  .strict();
export const ExampleInputSchema = z.object({ text: z.string().min(3).max(800) }).strict();
export const PublicStatusSchema = z
  .object({
    status: z.enum(["approved", "not_approved"]),
    claimId: z.string().min(1).max(100).optional(),
  })
  .strict();

const ATTRIBUTE_ORDER = [
  "name",
  "description",
  "inputTypes",
  "outputTypes",
  "buyerProblems",
  "limitations",
  "requiredExpertise",
  "potentialPaidTypeKey",
] as const;

/** Attributes still "to be provided": null, blank or an empty list. */
export function placeholderAttributes(c: CapabilityRow): string[] {
  return ATTRIBUTE_ORDER.filter((k) => {
    const v = c[k];
    return v === null || (Array.isArray(v) ? v.length === 0 : v.trim() === "");
  });
}

export interface CapabilitySummary {
  id: string;
  slot: number;
  lockNo: number;
  name: string | null;
  publicClaimStatus: "not_approved" | "approved";
  publicClaimNeedsReview: boolean;
  placeholderAttributes: string[];
}
export interface CapabilityDetail extends CapabilitySummary {
  attributes: Omit<AttributeChange, never> &
    Record<(typeof ATTRIBUTE_ORDER)[number], string | string[] | null>;
  evidence: Pick<EvidenceRow, "id" | "basisKind" | "reference" | "note">[];
  offers: { offerId: string; name: string | null }[];
  publicClaimId: string | null;
  /** Present only for a caller holding capabilities.examples.read. */
  deliveryExamples?: Pick<ExampleRow, "id" | "text" | "addedAt">[];
}

export interface CapabilityDeps {
  now?: () => Date;
}

export class CapabilityService {
  private readonly clock: () => Date;
  constructor(
    readonly db: SqliteDatabase,
    deps: CapabilityDeps = {},
  ) {
    this.clock = deps.now ?? (() => new Date());
  }

  private claimNeedsReview(tx: Tx, c: CapabilityRow, at: string): boolean {
    if (c.publicClaimStatus !== "approved" || !c.publicClaimId) return false;
    const claim = getClaim(tx, c.publicClaimId);
    return !claim || effectiveStatus(claim, listClaimEvidence(tx, claim.id), at) !== "approved";
  }

  private summary(tx: Tx, c: CapabilityRow, at: string): CapabilitySummary {
    return {
      id: c.id,
      slot: c.slot,
      lockNo: c.lockNo,
      name: c.name,
      publicClaimStatus: c.publicClaimStatus,
      publicClaimNeedsReview: this.claimNeedsReview(tx, c, at),
      placeholderAttributes: placeholderAttributes(c),
    };
  }

  private detail(tx: Tx, c: CapabilityRow, at: string, withExamples: boolean): CapabilityDetail {
    const detail: CapabilityDetail = {
      ...this.summary(tx, c, at),
      attributes: {
        name: c.name,
        description: c.description,
        inputTypes: c.inputTypes,
        outputTypes: c.outputTypes,
        buyerProblems: c.buyerProblems,
        limitations: c.limitations,
        requiredExpertise: c.requiredExpertise,
        potentialPaidTypeKey: c.potentialPaidTypeKey,
      },
      evidence: listEvidence(tx, c.id).map((e) => ({
        id: e.id,
        basisKind: e.basisKind,
        reference: e.reference,
        note: e.note,
      })),
      offers: offerIdsFor(tx, c.id).map((offerId) => ({ offerId, name: offerName(tx, offerId) })),
      publicClaimId: c.publicClaimId,
    };
    if (withExamples) {
      detail.deliveryExamples = listExamples(tx, c.id).map((e) => ({
        id: e.id,
        text: e.text,
        addedAt: e.addedAt,
      }));
    }
    return detail;
  }

  private row(tx: Tx, id: string): CapabilityRow {
    const c = getCapability(tx, id);
    if (!c) throw new CatalogueRefusal(404, "Capability not found", ["not_found"]);
    return c;
  }

  list(actor: CatalogueActor): CapabilitySummary[] {
    return audited(this.db, actor, "capability.read.refused", "service_capability", null, () => {
      requirePermission(actor, "capabilities.read");
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => listCapabilities(tx).map((c) => this.summary(tx, c, at)));
    });
  }

  get(actor: CatalogueActor, id: string): CapabilityDetail {
    return audited(this.db, actor, "capability.read.refused", "service_capability", id, () => {
      requirePermission(actor, "capabilities.read");
      const at = nowOf(actor).toISOString();
      const examples = hasPermission(
        [{ key: "actor", permissions: actor.permissions }],
        "capabilities.examples.read",
      );
      return this.db.transaction((tx) => this.detail(tx, this.row(tx, id), at, examples));
    });
  }

  /** The capabilities linked to an offer (visible from both sides). */
  offersFor(actor: CatalogueActor, offerId: string): CapabilitySummary[] {
    return audited(this.db, actor, "capability.read.refused", "service_capability", null, () => {
      requirePermission(actor, "capabilities.read");
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) =>
        capabilityIdsFor(tx, offerId).map((id) => this.summary(tx, this.row(tx, id), at)),
      );
    });
  }

  /** What may be shown outside: approved capabilities whose public claim is still valid, no examples. */
  publicView(): PublicCapability[] {
    const at = this.clock().toISOString();
    return this.db.transaction((tx) =>
      listCapabilities(tx)
        .filter((c) => c.publicClaimStatus === "approved" && !this.claimNeedsReview(tx, c, at))
        .map(toPublicCapability),
    );
  }

  update(actor: CatalogueActor, id: string, raw: unknown): CapabilityDetail {
    const input = parseOrThrow(CapabilityChangeSchema, raw);
    return audited(this.db, actor, "capability.edit.refused", "service_capability", id, () => {
      requirePermission(actor, "capabilities.edit");
      guardFreeText({ attributes: input.attributes });
      const at = nowOf(actor).toISOString();
      return this.db.transaction((tx) => {
        this.row(tx, id);
        const key = input.attributes.potentialPaidTypeKey;
        if (key && !paidTypeExists(tx, key)) {
          throw new CatalogueRefusal(
            400,
            "Unknown paid engagement type",
            ["unknown_paid_type"],
            [],
            "The paid engagement type does not exist.",
          );
        }
        const change = Object.fromEntries(
          Object.entries(input.attributes).filter(([, v]) => v !== undefined),
        ) as AttributeChange;
        if (!updateAttributes(tx, id, input.lockNo, change)) {
          throw new CatalogueRefusal(
            409,
            "Stale version",
            ["stale_version"],
            [],
            "The capability changed. Reload and try again.",
          );
        }
        this.record(tx, actor, "capability.edit", id, { changed: Object.keys(change) });
        emitCapabilityUpdated(tx, ctx(actor), { capabilityId: id, change: "edit" });
        return this.detail(tx, this.row(tx, id), at, false);
      });
    });
  }

  addEvidence(actor: CatalogueActor, id: string, raw: unknown): CapabilityDetail {
    const input = parseOrThrow(EvidenceInputSchema, raw);
    return audited(
      this.db,
      actor,
      "capability.evidence.add.refused",
      "service_capability",
      id,
      () => {
        requirePermission(actor, "capabilities.edit");
        guardFreeText({ reference: input.reference, note: input.note });
        const at = nowOf(actor).toISOString();
        return this.db.transaction((tx) => {
          this.row(tx, id);
          insertEvidence(tx, {
            id: uuidv7(),
            capabilityId: id,
            basisKind: input.basisKind,
            reference: input.reference,
            note: input.note ?? null,
            addedBy: actor.userId as string,
            addedAt: at,
          });
          this.record(tx, actor, "capability.evidence.add", id, { basis_kind: input.basisKind });
          emitCapabilityUpdated(tx, ctx(actor), { capabilityId: id, change: "evidence" });
          return this.detail(tx, this.row(tx, id), at, false);
        });
      },
    );
  }

  addExample(actor: CatalogueActor, id: string, raw: unknown): CapabilityDetail {
    const input = parseOrThrow(ExampleInputSchema, raw);
    return audited(
      this.db,
      actor,
      "capability.example.add.refused",
      "service_capability",
      id,
      () => {
        requirePermission(actor, "capabilities.edit");
        requirePermission(actor, "capabilities.examples.read");
        guardFreeText({ text: input.text });
        const at = nowOf(actor).toISOString();
        return this.db.transaction((tx) => {
          this.row(tx, id);
          insertExample(tx, {
            id: uuidv7(),
            capabilityId: id,
            text: input.text,
            addedBy: actor.userId as string,
            addedAt: at,
          });
          this.record(tx, actor, "capability.example.add", id, {});
          emitCapabilityUpdated(tx, ctx(actor), { capabilityId: id, change: "edit" });
          return this.detail(tx, this.row(tx, id), at, true);
        });
      },
    );
  }

  link(actor: CatalogueActor, id: string, offerId: string): void {
    this.changeLink(actor, id, offerId, "link");
  }
  unlink(actor: CatalogueActor, id: string, offerId: string): void {
    this.changeLink(actor, id, offerId, "unlink");
  }
  private changeLink(
    actor: CatalogueActor,
    id: string,
    offerId: string,
    op: "link" | "unlink",
  ): void {
    audited(this.db, actor, `capability.${op}.refused`, "service_capability", id, () => {
      requirePermission(actor, "capabilities.edit");
      this.db.transaction((tx) => {
        this.row(tx, id);
        if (!offerExists(tx, offerId))
          throw new CatalogueRefusal(404, "Offer not found", ["not_found"]);
        if (op === "link") link(tx, id, offerId);
        else unlink(tx, id, offerId);
        this.record(tx, actor, `capability.${op}`, id, { offer_id: offerId });
        emitCapabilityUpdated(tx, ctx(actor), { capabilityId: id, change: "link" });
      });
    });
  }

  /** Approve a capability for public claims only with complete attributes, an evidence basis and an approved claim. */
  setPublicClaimStatus(actor: CatalogueActor, id: string, raw: unknown): CapabilityDetail {
    const input = parseOrThrow(PublicStatusSchema, raw);
    return audited(
      this.db,
      actor,
      "capability.public_status.refused",
      "service_capability",
      id,
      () => {
        requirePermission(actor, "claims.approve");
        const at = nowOf(actor).toISOString();
        return this.db.transaction((tx) => {
          const c = this.row(tx, id);
          if (input.status === "approved") {
            const problems: string[] = [];
            const codes: string[] = [];
            const missing = placeholderAttributes(c);
            if (missing.length > 0) {
              codes.push("placeholder_attributes");
              problems.push(`Attributes are still to be provided: ${missing.join(", ")}`);
            }
            if (listEvidence(tx, id).length === 0) {
              codes.push("no_evidence_basis");
              problems.push("No evidence basis is recorded for this capability");
            }
            const claim = input.claimId ? getClaim(tx, input.claimId) : null;
            if (
              !claim ||
              effectiveStatus(claim, listClaimEvidence(tx, claim.id), at) !== "approved"
            ) {
              codes.push("claim_not_approved");
              problems.push("An approved claim with valid evidence is required");
            }
            if (codes.length > 0) {
              throw new CatalogueRefusal(
                409,
                "Capability cannot be approved",
                codes,
                [],
                `${problems.join("; ")}.`,
              );
            }
          }
          setPublicStatus(
            tx,
            id,
            input.status,
            input.status === "approved" ? (input.claimId as string) : null,
          );
          this.record(tx, actor, "capability.public_status", id, { status: input.status });
          emitCapabilityUpdated(tx, ctx(actor), { capabilityId: id, change: "public_status" });
          return this.detail(tx, this.row(tx, id), at, false);
        });
      },
    );
  }

  private record(
    tx: Tx,
    actor: CatalogueActor,
    action: string,
    id: string,
    after: Record<string, unknown>,
  ): void {
    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: actor.actorType,
        action,
        entityType: "service_capability",
        entityId: id,
        outcome: "success",
        after,
        correlationId: actor.correlationId,
      },
      actor.now,
    );
  }
}

const ctx = (a: CatalogueActor) => ({
  actorId: a.userId,
  actorType: a.actorType,
  correlationId: a.correlationId,
  now: a.now,
});
