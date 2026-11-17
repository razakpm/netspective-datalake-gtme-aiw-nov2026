import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SqliteDatabase, Tx } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";
import { HttpError } from "../../http/errors.js";
import { recordAudit } from "./writer.js";

// Quarantine (task T067, spec FR-020). Held content is encrypted at the application layer (AES-256-GCM)
// with a key from configuration that never lives in the database. Reading content is limited to
// `quarantine.review` by the routes, every read is logged and audited, release and discard need a human
// and a reason, and content is purged after the holding period.

const HEADER = "v1";

export interface QuarantineMeta {
  id: string;
  entryPoint: string;
  ruleIds: string[];
  guardVersion: string;
  status: "held" | "released" | "discarded";
  createdAt: string;
  heldUntil: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  contentPurged: boolean;
}

interface Row {
  id: string;
  entry_point: string;
  reason_rule_ids: string;
  guard_version: string;
  content_encrypted: Uint8Array | null;
  content_sha256: string;
  status: QuarantineMeta["status"];
  created_at: string;
  held_until: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  released_consumed_at: string | null;
}

export class QuarantineService {
  private readonly key: Buffer;

  constructor(
    private readonly db: SqliteDatabase,
    encryptionKey: string,
    private readonly holdDays = 30,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (encryptionKey.length < 32)
      throw new Error("quarantine encryption key must be at least 32 characters");
    this.key = createHash("sha256").update(encryptionKey).digest();
  }

  // ---- crypto ------------------------------------------------------------------------------------

  private encrypt(plain: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from(HEADER), iv, cipher.getAuthTag(), body]);
  }

  private decrypt(blob: Uint8Array): string {
    const buffer = Buffer.from(blob);
    const iv = buffer.subarray(2, 14);
    const tag = buffer.subarray(14, 30);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buffer.subarray(30)), decipher.final()]).toString("utf8");
  }

  // ---- hold --------------------------------------------------------------------------------------

  /** Hold suspected-prohibited content. Called by the guard at entry points configured for review. */
  hold(
    tx: Tx,
    input: { entryPoint: string; content: string; ruleIds: string[]; guardVersion: string },
  ): string {
    const id = uuidv7();
    const created = this.now();
    tx.prepare(
      `INSERT INTO quarantine_item (id, entry_point, reason_rule_ids, guard_version, content_encrypted,
         content_sha256, status, created_at, held_until) VALUES (?,?,?,?,?,?, 'held', ?, ?)`,
    ).run(
      id,
      input.entryPoint,
      JSON.stringify([...input.ruleIds].sort()),
      input.guardVersion,
      this.encrypt(input.content),
      createHash("sha256").update(input.content).digest("hex"),
      created.toISOString(),
      new Date(created.getTime() + this.holdDays * 86_400_000).toISOString(),
    );
    return id;
  }

  // ---- metadata (never content) -----------------------------------------------------------------

  list(status?: QuarantineMeta["status"]): QuarantineMeta[] {
    const rows = this.db.raw
      .prepare(
        "SELECT * FROM quarantine_item WHERE (? IS NULL OR status = ?) ORDER BY id DESC LIMIT 200",
      )
      .all(status ?? null, status ?? null) as unknown as Row[];
    return rows.map(meta);
  }

  getMeta(id: string): QuarantineMeta {
    return meta(this.row(this.db.raw, id));
  }

  // ---- content (audited) ------------------------------------------------------------------------

  /** Read held content. Logs the access and writes an audit event in the same transaction. */
  view(
    tx: Tx,
    actor: { userId: string; correlationId: string | null },
    id: string,
    purpose: string,
  ): string {
    const row = this.row(tx, id);
    if (!row.content_encrypted) throw new HttpError(410, "Gone", "The content has been purged");
    tx.prepare(
      "INSERT INTO quarantine_access (id, item_id, actor_id, accessed_at, purpose) VALUES (?,?,?,?,?)",
    ).run(uuidv7(), id, actor.userId, this.now().toISOString(), purpose);
    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: "human",
        action: "quarantine.viewed",
        entityType: "quarantine_item",
        entityId: id,
        outcome: "success",
        after: { purpose },
        correlationId: actor.correlationId,
      },
      this.now,
    );
    return this.decrypt(row.content_encrypted);
  }

  // ---- decisions --------------------------------------------------------------------------------

  release(tx: Tx, actor: Decider, id: string, reason: string): QuarantineMeta {
    return this.decide(tx, actor, id, reason, "released");
  }

  discard(tx: Tx, actor: Decider, id: string, reason: string): QuarantineMeta {
    return this.decide(tx, actor, id, reason, "discarded");
  }

  private decide(
    tx: Tx,
    actor: Decider,
    id: string,
    reason: string,
    to: "released" | "discarded",
  ): QuarantineMeta {
    if (actor.actorType !== "human") {
      throw new HttpError(
        403,
        "Forbidden",
        "Only a human can release or discard quarantined content",
      );
    }
    if (reason.trim().length < 3)
      throw new HttpError(422, "Reason required", "A reason is required");
    const row = this.row(tx, id);
    if (row.status !== "held")
      throw new HttpError(409, "Conflict", "This item has already been decided");
    tx.prepare(
      "UPDATE quarantine_item SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ?",
    ).run(to, actor.userId, this.now().toISOString(), reason, id);
    if (to === "discarded")
      tx.prepare("UPDATE quarantine_item SET content_encrypted = NULL WHERE id = ?").run(id);
    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: "human",
        action: to === "released" ? "quarantine.released" : "quarantine.discarded",
        entityType: "quarantine_item",
        entityId: id,
        outcome: "success",
        before: { status: "held" },
        after: { status: to, reason },
        correlationId: actor.correlationId,
      },
      this.now,
    );
    return meta(this.row(tx, id));
  }

  /**
   * A released item re-enters the pipeline exactly once, and is not re-blocked by the rule version that
   * held it. Returns the content, or throws if it was not released or was already consumed.
   */
  consumeRelease(tx: Tx, id: string): { content: string; releasedFromGuardVersion: string } {
    const row = this.row(tx, id);
    if (row.status !== "released" || !row.content_encrypted) {
      throw new HttpError(409, "Conflict", "This item is not available for release");
    }
    if (row.released_consumed_at)
      throw new HttpError(409, "Conflict", "This released item was already used");
    tx.prepare("UPDATE quarantine_item SET released_consumed_at = ? WHERE id = ?").run(
      this.now().toISOString(),
      id,
    );
    return {
      content: this.decrypt(row.content_encrypted),
      releasedFromGuardVersion: row.guard_version,
    };
  }

  // ---- retention --------------------------------------------------------------------------------

  /** Purge content past the holding period (the row and its metadata stay). Returns the count purged. */
  purgeExpired(tx: Tx): number {
    const result = tx
      .prepare(
        "UPDATE quarantine_item SET content_encrypted = NULL WHERE content_encrypted IS NOT NULL AND held_until <= ?",
      )
      .run(this.now().toISOString());
    const count = Number(result.changes);
    if (count > 0) {
      recordAudit(
        tx,
        {
          actorId: null,
          actorType: "system",
          action: "quarantine.purged",
          entityType: "quarantine_item",
          outcome: "success",
          after: { count },
        },
        this.now,
      );
    }
    return count;
  }

  private row(tx: Tx, id: string): Row {
    const row = tx.prepare("SELECT * FROM quarantine_item WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new HttpError(404, "Not found");
    return row;
  }
}

export interface Decider {
  userId: string;
  actorType: "human" | "ai" | "system";
  correlationId: string | null;
}

function meta(row: Row): QuarantineMeta {
  return {
    id: row.id,
    entryPoint: row.entry_point,
    ruleIds: JSON.parse(row.reason_rule_ids) as string[],
    guardVersion: row.guard_version,
    status: row.status,
    createdAt: row.created_at,
    heldUntil: row.held_until,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    contentPurged: row.content_encrypted === null,
  };
}
