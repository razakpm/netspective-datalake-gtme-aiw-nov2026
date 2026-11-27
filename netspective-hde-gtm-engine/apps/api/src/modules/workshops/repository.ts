import type { Tx } from "@gtm/db";
import type { ArtifactState, WorkshopState } from "@gtm/domain";

// Persistence for workshops, their history and participants (feature 007, migration 0023). SQL only: every
// rule lives in packages/domain or the services.

export type BookingRoute = "manual" | "calendar";

export interface WorkshopRow {
  id: string;
  requestId: string;
  offerId: string;
  intakeId: string;
  accountId: string;
  contactId: string;
  state: WorkshopState;
  durationMinutes: number;
  scheduledAt: string | null;
  sessionDate: string | null;
  bookingId: string | null;
  bookingRoute: BookingRoute | null;
  calendarRef: string | null;
  lockNo: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/** The columns a state move may change. */
export interface WorkshopChange {
  state: WorkshopState;
  scheduledAt: string | null;
  sessionDate: string | null;
  bookingId: string | null;
  bookingRoute: BookingRoute | null;
  calendarRef: string | null;
  closedAt: string | null;
}

export interface HistoryRow {
  id: string;
  fromState: WorkshopState | null;
  toState: WorkshopState;
  note: string | null;
  scheduledFrom: string | null;
  scheduledTo: string | null;
  changedBy: string;
  changedAt: string;
}

export interface ParticipantRow {
  id: string;
  workshopId: string;
  side: "buyer" | "delivery";
  displayName: string;
  roleTitle: string | null;
  contactId: string | null;
  userId: string | null;
  addedBy: string;
  addedAt: string;
  removedAt: string | null;
  removedBy: string | null;
}

export type ParticipantView = Omit<ParticipantRow, "workshopId">;

export function participantView(row: ParticipantRow): ParticipantView {
  const view: Partial<ParticipantRow> = { ...row };
  delete view.workshopId;
  return view as ParticipantView;
}

const COLUMNS: Record<keyof WorkshopRow, string> = {
  id: "id",
  requestId: "request_id",
  offerId: "offer_id",
  intakeId: "intake_id",
  accountId: "account_id",
  contactId: "contact_id",
  state: "state",
  durationMinutes: "duration_minutes",
  scheduledAt: "scheduled_at",
  sessionDate: "session_date",
  bookingId: "booking_id",
  bookingRoute: "booking_route",
  calendarRef: "calendar_ref",
  lockNo: "lock_no",
  createdBy: "created_by",
  createdAt: "created_at",
  updatedAt: "updated_at",
  closedAt: "closed_at",
};

const aliased = <T>(columns: Record<string, string>): string =>
  Object.entries(columns as Record<keyof T & string, string>)
    .map(([key, column]) => `${column} AS "${key}"`)
    .join(", ");

const WORKSHOP = aliased<WorkshopRow>(COLUMNS);
const HISTORY = aliased<HistoryRow>({
  id: "id",
  fromState: "from_state",
  toState: "to_state",
  note: "note",
  scheduledFrom: "scheduled_from",
  scheduledTo: "scheduled_to",
  changedBy: "changed_by",
  changedAt: "changed_at",
});
const PARTICIPANT = aliased<ParticipantRow>({
  id: "id",
  workshopId: "workshop_id",
  side: "side",
  displayName: "display_name",
  roleTitle: "role_title",
  contactId: "contact_id",
  userId: "user_id",
  addedBy: "added_by",
  addedAt: "added_at",
  removedAt: "removed_at",
  removedBy: "removed_by",
});

// node:sqlite rows have no prototype; copy them into plain objects.
const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T;

export function insertWorkshop(tx: Tx, w: WorkshopRow): void {
  const keys = Object.keys(COLUMNS) as (keyof WorkshopRow)[];
  tx.prepare(
    `INSERT INTO workshop (${keys.map((k) => COLUMNS[k]).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...keys.map((k) => w[k]));
}

export function getWorkshop(tx: Tx, id: string): WorkshopRow | undefined {
  const row = tx.prepare(`SELECT ${WORKSHOP} FROM workshop WHERE id = ?`).get(id);
  return row ? plain<WorkshopRow>(row) : undefined;
}

export function listWorkshops(tx: Tx, state?: string): WorkshopRow[] {
  return tx
    .prepare(
      `SELECT ${WORKSHOP} FROM workshop WHERE (? IS NULL OR state = ?) ORDER BY created_at DESC, rowid DESC LIMIT 200`,
    )
    .all(state ?? null, state ?? null)
    .map((row) => plain<WorkshopRow>(row));
}

export function hasOpenWorkshop(tx: Tx, requestId: string): boolean {
  return (
    tx
      .prepare(
        "SELECT 1 FROM workshop WHERE request_id = ? AND state IN ('requested','booked','held','findings_recorded')",
      )
      .get(requestId) !== undefined
  );
}

/** Apply a change if nobody else changed the row first. False means the caller's copy is stale. */
export function updateWorkshop(
  tx: Tx,
  id: string,
  change: Partial<WorkshopChange>,
  expectedLockNo: number,
  at: string,
): boolean {
  const keys = Object.keys(change) as (keyof WorkshopChange)[];
  const sets = [...keys.map((k) => `${COLUMNS[k]} = ?`), "lock_no = lock_no + 1", "updated_at = ?"];
  const result = tx
    .prepare(`UPDATE workshop SET ${sets.join(", ")} WHERE id = ? AND lock_no = ?`)
    .run(...keys.map((k) => change[k] ?? null), at, id, expectedLockNo);
  return Number(result.changes) === 1;
}

export function insertHistory(tx: Tx, workshopId: string, h: HistoryRow): void {
  tx.prepare(
    `INSERT INTO workshop_state_history (id, workshop_id, from_state, to_state, note, scheduled_from,
       scheduled_to, changed_by, changed_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    h.id,
    workshopId,
    h.fromState,
    h.toState,
    h.note,
    h.scheduledFrom,
    h.scheduledTo,
    h.changedBy,
    h.changedAt,
  );
}

export const listHistory = (tx: Tx, workshopId: string): HistoryRow[] =>
  tx
    .prepare(`SELECT ${HISTORY} FROM workshop_state_history WHERE workshop_id = ? ORDER BY rowid`)
    .all(workshopId)
    .map((row) => plain<HistoryRow>(row));

export function insertParticipant(tx: Tx, p: ParticipantRow): void {
  tx.prepare(
    `INSERT INTO workshop_participant (id, workshop_id, side, display_name, role_title, contact_id, user_id,
       added_by, added_at, removed_at, removed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    p.id,
    p.workshopId,
    p.side,
    p.displayName,
    p.roleTitle,
    p.contactId,
    p.userId,
    p.addedBy,
    p.addedAt,
    p.removedAt,
    p.removedBy,
  );
}

export const listParticipants = (tx: Tx, workshopId: string): ParticipantRow[] =>
  tx
    .prepare(`SELECT ${PARTICIPANT} FROM workshop_participant WHERE workshop_id = ? ORDER BY rowid`)
    .all(workshopId)
    .map((row) => plain<ParticipantRow>(row));

export function getParticipant(tx: Tx, id: string): ParticipantRow | undefined {
  const row = tx.prepare(`SELECT ${PARTICIPANT} FROM workshop_participant WHERE id = ?`).get(id);
  return row ? plain<ParticipantRow>(row) : undefined;
}

export function markParticipantRemoved(tx: Tx, id: string, by: string, at: string): void {
  tx.prepare("UPDATE workshop_participant SET removed_at = ?, removed_by = ? WHERE id = ?").run(
    at,
    by,
    id,
  );
}

export interface ArtifactRow {
  id: string;
  workshopId: string;
  kind: string;
  title: string;
  reference: string | null;
  storageKey: string | null;
  sizeBytes: number | null;
  contentSha256: string | null;
  suppliedBy: string | null;
  recordedBy: string;
  recordedAt: string;
  state: ArtifactState;
  quarantineItemId: string | null;
  holdRuleIdsJson: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  fileDeletedAt: string | null;
}

const ARTIFACT_COLUMNS: Record<keyof ArtifactRow, string> = {
  id: "id",
  workshopId: "workshop_id",
  kind: "kind",
  title: "title",
  reference: "reference",
  storageKey: "storage_key",
  sizeBytes: "size_bytes",
  contentSha256: "content_sha256",
  suppliedBy: "supplied_by_label",
  recordedBy: "recorded_by",
  recordedAt: "recorded_at",
  state: "state",
  quarantineItemId: "quarantine_item_id",
  holdRuleIdsJson: "hold_rule_ids_json",
  decidedBy: "decided_by",
  decidedAt: "decided_at",
  fileDeletedAt: "file_deleted_at",
};
const ARTIFACT = aliased<ArtifactRow>(ARTIFACT_COLUMNS);

export function insertArtifact(tx: Tx, a: ArtifactRow): void {
  const keys = Object.keys(ARTIFACT_COLUMNS) as (keyof ArtifactRow)[];
  tx.prepare(
    `INSERT INTO workshop_artifact (${keys.map((k) => ARTIFACT_COLUMNS[k]).join(",")}, classification)
     VALUES (${keys.map(() => "?").join(",")}, 'non_phi')`,
  ).run(...keys.map((k) => a[k]));
}

export function getArtifact(tx: Tx, id: string): ArtifactRow | undefined {
  const row = tx.prepare(`SELECT ${ARTIFACT} FROM workshop_artifact WHERE id = ?`).get(id);
  return row ? plain<ArtifactRow>(row) : undefined;
}

export const listArtifacts = (tx: Tx, workshopId: string): ArtifactRow[] =>
  tx
    .prepare(`SELECT ${ARTIFACT} FROM workshop_artifact WHERE workshop_id = ? ORDER BY rowid`)
    .all(workshopId)
    .map((row) => plain<ArtifactRow>(row));

/** Move a held artifact to released (with its stored file) or discarded. False: someone else did. */
export function decideArtifact(
  tx: Tx,
  id: string,
  decision: {
    state: "released" | "discarded";
    storageKey?: string;
    sizeBytes?: number;
    contentSha256?: string;
    decidedBy: string | null;
    decidedAt: string;
  },
): boolean {
  const current = getArtifact(tx, id);
  if (current?.state !== "held") return false;
  tx.prepare(
    `UPDATE workshop_artifact SET state = ?, storage_key = ?, size_bytes = ?, content_sha256 = ?,
       decided_by = ?, decided_at = ? WHERE id = ?`,
  ).run(
    decision.state,
    decision.storageKey ?? null,
    decision.sizeBytes ?? null,
    decision.contentSha256 ?? null,
    decision.decidedBy,
    decision.decidedAt,
    id,
  );
  return true;
}

export interface FindingRow {
  id: string;
  workshopId: string;
  versionNo: number;
  kind: "offer_1" | "offer_6";
  schemaVersion: number;
  contentJson: string;
  state: "draft" | "finalised";
  waiverReason: string | null;
  correctionReason: string | null;
  lockNo: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  finalisedBy: string | null;
  finalisedAt: string | null;
}

const FINDING_COLUMNS: Record<keyof FindingRow, string> = {
  id: "id",
  workshopId: "workshop_id",
  versionNo: "version_no",
  kind: "kind",
  schemaVersion: "schema_version",
  contentJson: "content_json",
  state: "state",
  waiverReason: "waiver_reason",
  correctionReason: "correction_reason",
  lockNo: "lock_no",
  createdBy: "created_by",
  createdAt: "created_at",
  updatedAt: "updated_at",
  finalisedBy: "finalised_by",
  finalisedAt: "finalised_at",
};
const FINDING = aliased<FindingRow>(FINDING_COLUMNS);

export function insertFinding(tx: Tx, f: FindingRow): void {
  const keys = Object.keys(FINDING_COLUMNS) as (keyof FindingRow)[];
  tx.prepare(
    `INSERT INTO workshop_finding (${keys.map((k) => FINDING_COLUMNS[k]).join(",")}, classification)
     VALUES (${keys.map(() => "?").join(",")}, 'non_phi')`,
  ).run(...keys.map((k) => f[k]));
}

/** Every version, oldest first. */
export const listFindings = (tx: Tx, workshopId: string): FindingRow[] =>
  tx
    .prepare(`SELECT ${FINDING} FROM workshop_finding WHERE workshop_id = ? ORDER BY version_no`)
    .all(workshopId)
    .map((row) => plain<FindingRow>(row));

/** Save a draft if nobody else saved it first. False means the caller's copy is stale. */
export function updateDraftContent(
  tx: Tx,
  id: string,
  contentJson: string,
  expectedLockNo: number,
  at: string,
): boolean {
  const result = tx
    .prepare(
      `UPDATE workshop_finding SET content_json = ?, lock_no = lock_no + 1, updated_at = ?
       WHERE id = ? AND state = 'draft' AND lock_no = ?`,
    )
    .run(contentJson, at, id, expectedLockNo);
  return Number(result.changes) === 1;
}

export function finaliseDraft(
  tx: Tx,
  id: string,
  by: string,
  at: string,
  waiverReason: string | null,
): void {
  tx.prepare(
    `UPDATE workshop_finding SET state = 'finalised', finalised_by = ?, finalised_at = ?, updated_at = ?,
       waiver_reason = ?, lock_no = lock_no + 1 WHERE id = ? AND state = 'draft'`,
  ).run(by, at, at, waiverReason, id);
}

export interface BriefRow {
  id: string;
  workshopId: string;
  versionNo: number;
  contentJson: string;
  source: "baseline" | "model";
  aiInvocationId: string | null;
  model: string | null;
  promptVersion: string | null;
  schemaVersion: string | null;
  confidence: "low" | "medium" | "high" | null;
  rationale: string | null;
  reviewStatus: "unreviewed" | "reviewed";
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdBy: string;
  createdAt: string;
}

const BRIEF_COLUMNS: Record<keyof BriefRow, string> = {
  id: "id",
  workshopId: "workshop_id",
  versionNo: "version_no",
  contentJson: "content_json",
  source: "source",
  aiInvocationId: "ai_invocation_id",
  model: "model",
  promptVersion: "prompt_version",
  schemaVersion: "schema_version",
  confidence: "confidence",
  rationale: "rationale",
  reviewStatus: "review_status",
  reviewedBy: "reviewed_by",
  reviewedAt: "reviewed_at",
  createdBy: "created_by",
  createdAt: "created_at",
};
const BRIEF = aliased<BriefRow>(BRIEF_COLUMNS);

export function insertBrief(tx: Tx, b: BriefRow): void {
  const keys = Object.keys(BRIEF_COLUMNS) as (keyof BriefRow)[];
  tx.prepare(
    `INSERT INTO workshop_brief (${keys.map((k) => BRIEF_COLUMNS[k]).join(",")})
     VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...keys.map((k) => b[k]));
}

/** Every brief, oldest first. */
export const listBriefs = (tx: Tx, workshopId: string): BriefRow[] =>
  tx
    .prepare(`SELECT ${BRIEF} FROM workshop_brief WHERE workshop_id = ? ORDER BY version_no`)
    .all(workshopId)
    .map((row) => plain<BriefRow>(row));

export function markBriefRow(tx: Tx, id: string, by: string, at: string): void {
  tx.prepare(
    "UPDATE workshop_brief SET review_status = 'reviewed', reviewed_by = ?, reviewed_at = ? WHERE id = ?",
  ).run(by, at, id);
}

export interface OutputRow {
  id: string;
  workshopId: string;
  findingId: string;
  revisionNo: number;
  sectionsJson: string;
  state: "draft" | "approved";
  editedBy: string;
  editedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  pdfStorageKey: string | null;
  pdfSha256: string | null;
  pdfPages: number | null;
  fileDeletedAt: string | null;
}

const OUTPUT_COLUMNS: Record<keyof OutputRow, string> = {
  id: "id",
  workshopId: "workshop_id",
  findingId: "finding_id",
  revisionNo: "revision_no",
  sectionsJson: "sections_json",
  state: "state",
  editedBy: "edited_by",
  editedAt: "edited_at",
  approvedBy: "approved_by",
  approvedAt: "approved_at",
  pdfStorageKey: "pdf_storage_key",
  pdfSha256: "pdf_sha256",
  pdfPages: "pdf_pages",
  fileDeletedAt: "file_deleted_at",
};
const OUTPUT = aliased<OutputRow>(OUTPUT_COLUMNS);

export function insertOutput(tx: Tx, o: OutputRow): void {
  const keys = Object.keys(OUTPUT_COLUMNS) as (keyof OutputRow)[];
  tx.prepare(
    `INSERT INTO workshop_output_document (${keys.map((k) => OUTPUT_COLUMNS[k]).join(",")})
     VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...keys.map((k) => o[k]));
}

/** Every revision, oldest first. */
export const listOutputs = (tx: Tx, workshopId: string): OutputRow[] =>
  tx
    .prepare(
      `SELECT ${OUTPUT} FROM workshop_output_document WHERE workshop_id = ? ORDER BY revision_no`,
    )
    .all(workshopId)
    .map((row) => plain<OutputRow>(row));

export function approveOutputRow(
  tx: Tx,
  id: string,
  a: { by: string; at: string; storageKey: string; sha256: string },
): boolean {
  const result = tx
    .prepare(
      `UPDATE workshop_output_document SET state = 'approved', approved_by = ?, approved_at = ?,
         pdf_storage_key = ?, pdf_sha256 = ?, pdf_pages = 1 WHERE id = ? AND state = 'draft'`,
    )
    .run(a.by, a.at, a.storageKey, a.sha256, id);
  return Number(result.changes) === 1;
}

export interface ShareRow {
  id: string;
  outputId: string;
  how: "handed_over" | "copied_link" | "other";
  note: string | null;
  sharedBy: string;
  sharedAt: string;
}

export function insertShare(tx: Tx, s: ShareRow): void {
  tx.prepare(
    "INSERT INTO workshop_output_share (id, output_id, how, note, shared_by, shared_at) VALUES (?,?,?,?,?,?)",
  ).run(s.id, s.outputId, s.how, s.note, s.sharedBy, s.sharedAt);
}

export const listShares = (tx: Tx, workshopId: string): ShareRow[] =>
  tx
    .prepare(
      `SELECT s.id AS "id", s.output_id AS "outputId", s.how AS "how", s.note AS "note",
         s.shared_by AS "sharedBy", s.shared_at AS "sharedAt"
       FROM workshop_output_share s JOIN workshop_output_document d ON d.id = s.output_id
       WHERE d.workshop_id = ? ORDER BY s.rowid`,
    )
    .all(workshopId)
    .map((row) => plain<ShareRow>(row));

export interface EffortRow {
  id: string;
  workshopId: string;
  prepHours: number;
  sessionHours: number;
  people: number;
  recordedBy: string;
  recordedAt: string;
}

const EFFORT = aliased<EffortRow>({
  id: "id",
  workshopId: "workshop_id",
  prepHours: "prep_hours",
  sessionHours: "session_hours",
  people: "people",
  recordedBy: "recorded_by",
  recordedAt: "recorded_at",
});

export function insertEffort(tx: Tx, e: EffortRow): void {
  tx.prepare(
    `INSERT INTO delivery_effort (id, workshop_id, prep_hours, session_hours, people, recorded_by, recorded_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(e.id, e.workshopId, e.prepHours, e.sessionHours, e.people, e.recordedBy, e.recordedAt);
}

/** Every entry, oldest first: the last one is current. */
export const listEffort = (tx: Tx, workshopId: string): EffortRow[] =>
  tx
    .prepare(`SELECT ${EFFORT} FROM delivery_effort WHERE workshop_id = ? ORDER BY rowid`)
    .all(workshopId)
    .map((row) => plain<EffortRow>(row));

/** Each workshop of an offer with its state and current effort. */
export const effortByOffer = (
  tx: Tx,
  offerId: string,
): { state: WorkshopState; current: EffortRow | null }[] =>
  (
    tx.prepare("SELECT id, state FROM workshop WHERE offer_id = ? ORDER BY rowid").all(offerId) as {
      id: string;
      state: WorkshopState;
    }[]
  ).map((w) => ({ state: w.state, current: listEffort(tx, w.id).at(-1) ?? null }));

export interface ExpiredFile {
  table: "workshop_artifact" | "workshop_output_document";
  id: string;
  workshopId: string;
  storageKey: string;
}

/**
 * Stored files of workshops that reached an end state before the cutoff, or never reached one and have not
 * changed since it (a new artifact, findings or page counts as a change). Held content is not here: it
 * follows the quarantine retention.
 */
export const expiredFiles = (tx: Tx, cutoff: string): ExpiredFile[] =>
  tx
    .prepare(
      `WITH expired AS (
         SELECT w.id FROM workshop w
         WHERE (w.closed_at IS NOT NULL AND w.closed_at < ?1)
            OR (w.closed_at IS NULL AND MAX(
                  w.updated_at,
                  COALESCE((SELECT MAX(recorded_at) FROM workshop_artifact a WHERE a.workshop_id = w.id), ''),
                  COALESCE((SELECT MAX(updated_at) FROM workshop_finding f WHERE f.workshop_id = w.id), ''),
                  COALESCE((SELECT MAX(edited_at) FROM workshop_output_document o WHERE o.workshop_id = w.id), '')
                ) < ?1)
       )
       SELECT 'workshop_artifact' AS "table", id AS "id", workshop_id AS "workshopId", storage_key AS "storageKey"
         FROM workshop_artifact
         WHERE storage_key IS NOT NULL AND file_deleted_at IS NULL AND workshop_id IN (SELECT id FROM expired)
       UNION ALL
       SELECT 'workshop_output_document', id, workshop_id, pdf_storage_key
         FROM workshop_output_document
         WHERE pdf_storage_key IS NOT NULL AND file_deleted_at IS NULL AND workshop_id IN (SELECT id FROM expired)`,
    )
    .all(cutoff)
    .map((row) => plain<ExpiredFile>(row));

export function markFileDeleted(tx: Tx, file: ExpiredFile, at: string): void {
  // The table name comes from the fixed union above, never from input.
  tx.prepare(`UPDATE ${file.table} SET file_deleted_at = ? WHERE id = ?`).run(at, file.id);
}
