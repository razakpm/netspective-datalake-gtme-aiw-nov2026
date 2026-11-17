import { createHash } from "node:crypto";
import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  DEFAULT_RETRY_POLICY,
  guardValue,
  nextAfterFailure,
  redactPhi,
  retryDelayMs,
  type AuditEventInput,
  type RetryPolicy,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { getCorrelationId } from "../../context.js";
import { HttpError } from "../../http/errors.js";
import { scrubSecrets } from "../../logging/logger.js";
import { recordAudit } from "../audit/index.js";

// Job service (task T077, spec FR-023 to FR-028). A SQLite-backed queue behind the same interface the
// Postgres/pg-boss version will have (ADR-015). Every transition is audited in the same transaction.
//   queued -> running -> succeeded
//   running -> queued   (retry with backoff while attempts remain)
//   running -> failed   (attempts exhausted)

export type JobState = "queued" | "running" | "succeeded" | "failed";

export interface JobView {
  id: string;
  queue: string;
  idempotencyKey: string;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  scheduledBy: string;
  /** Redacted. The payload is never exposed through views. */
  lastError: { code: string; message: string; stack_hash: string } | null;
  correlationId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** A claimed job, including its payload, for the worker only. */
export interface ClaimedJob extends JobView {
  payload: unknown;
}

interface Row {
  id: string;
  queue: string;
  idempotency_key: string;
  payload: string | null;
  state: JobState;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  scheduled_by: string;
  last_error: string | null;
  correlation_id: string | null;
  created_at: string;
  finished_at: string | null;
}

export function backPressure(queue: string, depth: number, cap: number): HttpError {
  return new HttpError(
    429,
    "Too many queued jobs",
    `Queue "${queue}" is at its limit (${depth}/${cap})`,
    {
      type: "urn:gtm:problem:back-pressure",
    },
  );
}

export interface JobServiceOptions {
  retry?: RetryPolicy;
  /** Jobs running at once per queue. */
  concurrency?: number;
  /** Queued plus running jobs allowed per queue before new submissions are refused. */
  queueDepthCap?: number;
  now?: () => Date;
  random?: () => number;
}

export class JobService {
  private readonly retry: RetryPolicy;
  private readonly concurrency: number;
  private readonly depthCap: number;
  private readonly now: () => Date;
  private readonly random: () => number;

  constructor(
    private readonly db: SqliteDatabase,
    options: JobServiceOptions = {},
  ) {
    this.retry = options.retry ?? DEFAULT_RETRY_POLICY;
    this.concurrency = options.concurrency ?? 5;
    this.depthCap = options.queueDepthCap ?? 1000;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  // ---- submit ------------------------------------------------------------------------------------

  /**
   * Enqueue a job. A duplicate (queue, idempotencyKey) returns the existing job, so it runs once.
   * Over the queue-depth cap the submission is refused with a typed 429, never dropped silently.
   */
  enqueue(input: {
    queue: string;
    idempotencyKey: string;
    payload: unknown;
    scheduledBy: string;
    correlationId?: string | null;
    maxAttempts?: number;
    runAt?: Date;
  }): { job: JobView; created: boolean } {
    return this.db.transaction((tx) => {
      const existing = this.byKey(tx, input.queue, input.idempotencyKey);
      if (existing) return { job: view(existing), created: false };

      const depth = (
        tx
          .prepare("SELECT count(*) c FROM job WHERE queue = ? AND state IN ('queued','running')")
          .get(input.queue) as { c: number }
      ).c;
      if (depth >= this.depthCap) throw backPressure(input.queue, depth, this.depthCap);

      const decision = guardValue(input.payload ?? null);
      if (decision.decision !== "allow") {
        throw new HttpError(422, "Job payload blocked", "The job payload cannot be stored", {
          type: "urn:gtm:problem:phi-blocked",
          ruleIds: decision.rule_ids,
        });
      }

      const id = uuidv7();
      const at = this.now().toISOString();
      const correlationId = input.correlationId ?? getCorrelationId() ?? null;
      tx.prepare(
        `INSERT INTO job (id, queue, idempotency_key, payload, state, attempts, max_attempts, next_run_at,
           scheduled_by, correlation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.queue,
        input.idempotencyKey,
        JSON.stringify(input.payload ?? null),
        input.maxAttempts ?? this.retry.maxAttempts,
        (input.runAt ?? this.now()).toISOString(),
        input.scheduledBy,
        correlationId,
        at,
        at,
      );
      this.audit(
        tx,
        "job.enqueued",
        id,
        null,
        { state: "queued", queue: input.queue },
        correlationId,
      );
      return { job: view(this.row(tx, id)), created: true };
    });
  }

  // ---- worker side -------------------------------------------------------------------------------

  /** Claim the next due job whose queue has a free concurrency slot. */
  claimNext(queues?: readonly string[]): ClaimedJob | null {
    return this.db.transaction((tx) => {
      const due = tx
        .prepare(
          "SELECT * FROM job WHERE state = 'queued' AND next_run_at <= ? ORDER BY next_run_at, id LIMIT 200",
        )
        .all(this.now().toISOString()) as unknown as Row[];
      for (const row of due) {
        if (queues && !queues.includes(row.queue)) continue;
        const running = (
          tx
            .prepare("SELECT count(*) c FROM job WHERE queue = ? AND state = 'running'")
            .get(row.queue) as {
            c: number;
          }
        ).c;
        if (running >= this.concurrency) continue;
        tx.prepare(
          "UPDATE job SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?",
        ).run(this.now().toISOString(), row.id);
        this.audit(
          tx,
          "job.started",
          row.id,
          { state: "queued" },
          { state: "running", attempt: row.attempts + 1 },
          row.correlation_id,
        );
        const claimed = this.row(tx, row.id);
        return {
          ...view(claimed),
          payload: claimed.payload ? (JSON.parse(claimed.payload) as unknown) : null,
        };
      }
      return null;
    });
  }

  complete(id: string): JobView {
    return this.db.transaction((tx) => {
      const row = this.requireRunning(tx, id);
      const at = this.now().toISOString();
      tx.prepare(
        "UPDATE job SET state = 'succeeded', updated_at = ?, finished_at = ?, last_error = NULL WHERE id = ?",
      ).run(at, at, id);
      this.audit(
        tx,
        "job.succeeded",
        id,
        { state: "running" },
        { state: "succeeded", attempts: row.attempts },
        row.correlation_id,
      );
      return view(this.row(tx, id));
    });
  }

  /** Record a failed attempt: retry with backoff while attempts remain, otherwise mark failed. */
  fail(id: string, error: unknown): JobView {
    return this.db.transaction((tx) => {
      const row = this.requireRunning(tx, id);
      const at = this.now();
      const redacted = JSON.stringify(redactError(error));
      const policy = { ...this.retry, maxAttempts: row.max_attempts };
      if (nextAfterFailure(row.attempts, policy) === "retry") {
        const delay = retryDelayMs(row.attempts, policy, this.random);
        tx.prepare(
          "UPDATE job SET state = 'queued', next_run_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
        ).run(new Date(at.getTime() + delay).toISOString(), redacted, at.toISOString(), id);
        this.audit(
          tx,
          "job.retry_scheduled",
          id,
          { state: "running" },
          { state: "queued", attempts: row.attempts, delayMs: delay },
          row.correlation_id,
        );
      } else {
        tx.prepare(
          "UPDATE job SET state = 'failed', last_error = ?, updated_at = ?, finished_at = ? WHERE id = ?",
        ).run(redacted, at.toISOString(), at.toISOString(), id);
        this.audit(
          tx,
          "job.failed",
          id,
          { state: "running" },
          { state: "failed", attempts: row.attempts },
          row.correlation_id,
        );
      }
      return view(this.row(tx, id));
    });
  }

  // ---- read side (never exposes payloads) --------------------------------------------------------

  list(filters: { state?: JobState; queue?: string; cursor?: string; limit?: number } = {}): {
    items: JobView[];
    nextCursor: string | null;
  } {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const rows = this.db.raw
      .prepare(
        `SELECT * FROM job WHERE (?1 IS NULL OR state = ?1) AND (?2 IS NULL OR queue = ?2) AND (?3 IS NULL OR id < ?3)
         ORDER BY id DESC LIMIT ?4`,
      )
      .all(
        filters.state ?? null,
        filters.queue ?? null,
        filters.cursor ?? null,
        limit + 1,
      ) as unknown as Row[];
    const page = rows.slice(0, limit);
    return {
      items: page.map(view),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  get(id: string): JobView {
    const row = this.db.raw.prepare("SELECT * FROM job WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new HttpError(404, "Not found");
    return view(row);
  }

  /** Queue depth by queue, for the administrator view. */
  stats(): { queue: string; queued: number; running: number; failed: number; depthCap: number }[] {
    const rows = this.db.raw
      .prepare(
        `SELECT queue,
           sum(state = 'queued') queued, sum(state = 'running') running, sum(state = 'failed') failed
         FROM job GROUP BY queue ORDER BY queue`,
      )
      .all() as { queue: string; queued: number; running: number; failed: number }[];
    return rows.map((r) => ({ ...r, depthCap: this.depthCap }));
  }

  // ---- internals ---------------------------------------------------------------------------------

  private audit(
    tx: Tx,
    action: string,
    jobId: string,
    before: unknown,
    after: unknown,
    correlationId: string | null,
  ): void {
    const event: AuditEventInput = {
      actorId: null,
      actorType: "system",
      action,
      entityType: "job",
      entityId: jobId,
      outcome: "success",
      before,
      after,
      correlationId,
    };
    recordAudit(tx, event, this.now);
  }

  private row(tx: Tx, id: string): Row {
    return tx.prepare("SELECT * FROM job WHERE id = ?").get(id) as unknown as Row;
  }
  private byKey(tx: Tx, queue: string, key: string): Row | undefined {
    return tx
      .prepare("SELECT * FROM job WHERE queue = ? AND idempotency_key = ?")
      .get(queue, key) as Row | undefined;
  }
  private requireRunning(tx: Tx, id: string): Row {
    const row = tx.prepare("SELECT * FROM job WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new HttpError(404, "Not found");
    if (row.state !== "running")
      throw new HttpError(409, "Conflict", `Job is ${row.state}, not running`);
    return row;
  }
}

function view(row: Row): JobView {
  return {
    id: row.id,
    queue: row.queue,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextRunAt: row.next_run_at,
    scheduledBy: row.scheduled_by,
    lastError: row.last_error ? (JSON.parse(row.last_error) as JobView["lastError"]) : null,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

/** code, message and a stack hash only: registered secrets scrubbed, PHI-like text replaced, no payload. */
export function redactError(error: unknown): { code: string; message: string; stack_hash: string } {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = scrubSecrets(String(redactPhi(err.message))).slice(0, 500);
  const stack = createHash("sha256")
    .update(err.stack ?? err.message)
    .digest("hex");
  return { code: err.name || "Error", message, stack_hash: stack };
}

/** Recurring schedules (FR-028): one occurrence maps to one idempotency key, so any number of
 * scheduler instances enqueue it once. */
export interface RecurringSchedule {
  name: string;
  queue: string;
  everySeconds: number;
  payload?: unknown;
}

export function tickSchedules(
  service: JobService,
  schedules: readonly RecurringSchedule[],
  now: Date = new Date(),
): number {
  let created = 0;
  for (const schedule of schedules) {
    const everyMs = schedule.everySeconds * 1000;
    const slot = new Date(Math.floor(now.getTime() / everyMs) * everyMs).toISOString();
    const result = service.enqueue({
      queue: schedule.queue,
      idempotencyKey: `schedule:${schedule.name}:${slot}`,
      payload: schedule.payload ?? {},
      scheduledBy: schedule.name,
    });
    if (result.created) created += 1;
  }
  return created;
}
