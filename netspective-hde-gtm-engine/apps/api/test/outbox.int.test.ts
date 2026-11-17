import { migrate, SqliteDatabase } from "@gtm/db";
import type { EventEnvelope } from "@gtm/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { CANARY_PHI } from "../../../packages/domain/test-support/canaries.js";
import { Dispatcher } from "../src/platform/events/dispatcher.js";
import { OutboxRejectedError, writeOutbox, type NewEvent } from "../src/platform/events/outbox.js";

// Interim SQLite run of T027 (ADR-015); the Postgres version remains open.
let db: SqliteDatabase;
beforeEach(() => {
  db = new SqliteDatabase();
  migrate(db);
});

const event = (payload: unknown = { n: 1 }): NewEvent => ({
  type: "thing.created",
  actor: { id: "u1", type: "human" },
  correlation_id: "corr-12345",
  causation_id: null,
  idempotency_key: null,
  payload,
  provenance: { source: "test" },
});
const count = (where = "1=1") =>
  (db.raw.prepare(`SELECT count(*) c FROM outbox_event WHERE ${where}`).get() as { c: number }).c;

describe("outbox", () => {
  it("writes the event in the same transaction as the change", () => {
    expect(() =>
      db.transaction((tx) => {
        writeOutbox(tx, event());
        throw new Error("boom");
      }),
    ).toThrow();
    expect(count()).toBe(0);
    db.transaction((tx) => writeOutbox(tx, event()));
    expect(count()).toBe(1);
  });

  it("rejects a PHI-like payload and writes nothing", () => {
    expect(() => db.transaction((tx) => writeOutbox(tx, event({ note: CANARY_PHI })))).toThrow(
      OutboxRejectedError,
    );
    expect(count()).toBe(0);
  });

  it("delivers a versioned envelope and marks it dispatched", async () => {
    db.transaction((tx) => writeOutbox(tx, event()));
    const seen: EventEnvelope[] = [];
    const d = new Dispatcher(db);
    d.on("thing.created", (e) => void seen.push(e));
    expect(await d.dispatchPending()).toBe(1);
    expect(seen[0]).toMatchObject({
      type: "thing.created",
      schema_version: 1,
      actor: { id: "u1", type: "human" },
      correlation_id: "corr-12345",
      payload: { n: 1 },
    });
    expect(count("dispatched_at IS NULL")).toBe(0);
    expect(await d.dispatchPending()).toBe(0);
  });

  it("redelivers after a crash between handling and marking (at-least-once)", async () => {
    db.transaction((tx) => writeOutbox(tx, event()));
    const ids: string[] = [];
    const flaky = new Dispatcher(db);
    flaky.on("thing.created", (e) => {
      ids.push(e.event_id);
      throw new Error("crash");
    });
    await expect(flaky.dispatchPending()).rejects.toThrow("crash");
    expect(count("dispatched_at IS NULL")).toBe(1);

    const healthy = new Dispatcher(db);
    healthy.on("thing.created", (e) => void ids.push(e.event_id));
    await healthy.dispatchPending();
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1); // same event_id, so consumers can deduplicate
  });
});
