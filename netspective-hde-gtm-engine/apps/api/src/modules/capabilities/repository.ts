import type { Tx } from "@gtm/db";

// Persistence for service capabilities, their evidence, internal delivery examples and offer links
// (feature 005). SQL only. Multi-valued attributes are JSON arrays; null means "to be provided".

type Row = Record<string, unknown>;

export interface CapabilityRow {
  id: string;
  slot: number;
  name: string | null;
  description: string | null;
  inputTypes: string[] | null;
  outputTypes: string[] | null;
  buyerProblems: string[] | null;
  limitations: string[] | null;
  requiredExpertise: string | null;
  potentialPaidTypeKey: string | null;
  publicClaimStatus: "not_approved" | "approved";
  publicClaimId: string | null;
  lockNo: number;
}
export interface EvidenceRow {
  id: string;
  capabilityId: string;
  basisKind: "delivery_record" | "published_material" | "internal_assessment";
  reference: string;
  note: string | null;
  addedBy: string;
  addedAt: string;
}
export interface ExampleRow {
  id: string;
  capabilityId: string;
  text: string;
  addedBy: string;
  addedAt: string;
}

const json = (v: unknown): string[] | null =>
  typeof v === "string" ? (JSON.parse(v) as string[]) : null;
const capability = (r: Row): CapabilityRow => ({
  id: r["id"] as string,
  slot: r["slot"] as number,
  name: r["name"] as string | null,
  description: r["description"] as string | null,
  inputTypes: json(r["input_types_json"]),
  outputTypes: json(r["output_types_json"]),
  buyerProblems: json(r["buyer_problems_json"]),
  limitations: json(r["limitations_json"]),
  requiredExpertise: r["required_expertise"] as string | null,
  potentialPaidTypeKey: r["potential_paid_type_key"] as string | null,
  publicClaimStatus: r["public_claim_status"] as CapabilityRow["publicClaimStatus"],
  publicClaimId: r["public_claim_id"] as string | null,
  lockNo: r["lock_no"] as number,
});

export const listCapabilities = (tx: Tx): CapabilityRow[] =>
  (tx.prepare("SELECT * FROM service_capability ORDER BY slot").all() as Row[]).map(capability);

export function getCapability(tx: Tx, id: string): CapabilityRow | null {
  const row = tx.prepare("SELECT * FROM service_capability WHERE id = ?").get(id) as
    Row | undefined;
  return row ? capability(row) : null;
}

export interface AttributeChange {
  name?: string | null;
  description?: string | null;
  inputTypes?: string[] | null;
  outputTypes?: string[] | null;
  buyerProblems?: string[] | null;
  limitations?: string[] | null;
  requiredExpertise?: string | null;
  potentialPaidTypeKey?: string | null;
}

const COLUMNS: Record<keyof AttributeChange, [string, boolean]> = {
  name: ["name", false],
  description: ["description", false],
  inputTypes: ["input_types_json", true],
  outputTypes: ["output_types_json", true],
  buyerProblems: ["buyer_problems_json", true],
  limitations: ["limitations_json", true],
  requiredExpertise: ["required_expertise", false],
  potentialPaidTypeKey: ["potential_paid_type_key", false],
};

/** Optimistic attribute update: returns false when the lock number moved on. */
export function updateAttributes(
  tx: Tx,
  id: string,
  expectedLock: number,
  change: AttributeChange,
): boolean {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  for (const [key, [column, isJson]] of Object.entries(COLUMNS) as [
    keyof AttributeChange,
    [string, boolean],
  ][]) {
    if (!(key in change)) continue;
    const v = change[key];
    sets.push(`${column} = ?`);
    values.push(v === null || v === undefined ? null : isJson ? JSON.stringify(v) : (v as string));
  }
  const res = tx
    .prepare(
      `UPDATE service_capability SET ${[...sets, "lock_no = lock_no + 1"].join(", ")} WHERE id = ? AND lock_no = ?`,
    )
    .run(...values, id, expectedLock);
  return Number(res.changes) === 1;
}

export function setPublicStatus(
  tx: Tx,
  id: string,
  status: "not_approved" | "approved",
  claimId: string | null,
): void {
  tx.prepare(
    "UPDATE service_capability SET public_claim_status = ?, public_claim_id = ?, lock_no = lock_no + 1 WHERE id = ?",
  ).run(status, claimId, id);
}

export function insertEvidence(tx: Tx, e: EvidenceRow): void {
  tx.prepare(
    "INSERT INTO capability_evidence (id, capability_id, basis_kind, reference, note, added_by, added_at) VALUES (?,?,?,?,?,?,?)",
  ).run(e.id, e.capabilityId, e.basisKind, e.reference, e.note, e.addedBy, e.addedAt);
}

export const listEvidence = (tx: Tx, capabilityId: string): EvidenceRow[] =>
  (
    tx
      .prepare("SELECT * FROM capability_evidence WHERE capability_id = ? ORDER BY added_at, rowid")
      .all(capabilityId) as Row[]
  ).map((r) => ({
    id: r["id"] as string,
    capabilityId: r["capability_id"] as string,
    basisKind: r["basis_kind"] as EvidenceRow["basisKind"],
    reference: r["reference"] as string,
    note: r["note"] as string | null,
    addedBy: r["added_by"] as string,
    addedAt: r["added_at"] as string,
  }));

export function insertExample(tx: Tx, e: ExampleRow): void {
  tx.prepare(
    "INSERT INTO capability_delivery_example (id, capability_id, text, added_by, added_at) VALUES (?,?,?,?,?)",
  ).run(e.id, e.capabilityId, e.text, e.addedBy, e.addedAt);
}

/** Internal only: the one reader of delivery example text, used by the permission-gated detail read. */
export const listExamples = (tx: Tx, capabilityId: string): ExampleRow[] =>
  (
    tx
      .prepare(
        "SELECT * FROM capability_delivery_example WHERE capability_id = ? ORDER BY added_at, rowid",
      )
      .all(capabilityId) as Row[]
  ).map((r) => ({
    id: r["id"] as string,
    capabilityId: r["capability_id"] as string,
    text: r["text"] as string,
    addedBy: r["added_by"] as string,
    addedAt: r["added_at"] as string,
  }));

export function link(tx: Tx, capabilityId: string, offerId: string): void {
  tx.prepare(
    "INSERT OR IGNORE INTO capability_offer_link (capability_id, offer_id) VALUES (?,?)",
  ).run(capabilityId, offerId);
}

export function unlink(tx: Tx, capabilityId: string, offerId: string): void {
  tx.prepare("DELETE FROM capability_offer_link WHERE capability_id = ? AND offer_id = ?").run(
    capabilityId,
    offerId,
  );
}

export const offerIdsFor = (tx: Tx, capabilityId: string): string[] =>
  (
    tx
      .prepare(
        "SELECT offer_id FROM capability_offer_link WHERE capability_id = ? ORDER BY offer_id",
      )
      .all(capabilityId) as Row[]
  ).map((r) => r["offer_id"] as string);

export const capabilityIdsFor = (tx: Tx, offerId: string): string[] =>
  (
    tx
      .prepare(
        "SELECT capability_id FROM capability_offer_link WHERE offer_id = ? ORDER BY capability_id",
      )
      .all(offerId) as Row[]
  ).map((r) => r["capability_id"] as string);

export const offerExists = (tx: Tx, offerId: string): boolean =>
  tx.prepare("SELECT 1 FROM engagement_offer WHERE id = ?").get(offerId) !== undefined;

export const paidTypeExists = (tx: Tx, key: string): boolean =>
  tx.prepare("SELECT 1 FROM paid_engagement_type WHERE key = ?").get(key) !== undefined;

export const offerName = (tx: Tx, offerId: string): string | null => {
  const row = tx
    .prepare(
      "SELECT json_extract(v.snapshot_json, '$.name') AS name FROM engagement_offer o JOIN offer_version v ON v.offer_id = o.id AND v.version_no = COALESCE(o.in_force_version_no, o.latest_version_no) WHERE o.id = ?",
    )
    .get(offerId) as Row | undefined;
  return (row?.["name"] as string | null | undefined) ?? null;
};
