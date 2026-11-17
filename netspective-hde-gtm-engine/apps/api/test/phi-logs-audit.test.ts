import { migrate, SqliteDatabase } from "@gtm/db";
import { describe, expect, it } from "vitest";
import { CANARY_PHI } from "../../../packages/domain/test-support/canaries.js";
import { createLogger } from "../src/logging/logger.js";
import { recordAudit } from "../src/modules/audit/index.js";
import { OutboxRejectedError, writeOutbox } from "../src/platform/events/outbox.js";

// FR-014 and FR-034 for suspected PHI (task T065). Job errors are covered when jobs land (T078).
function capture() {
  const lines: string[] = [];
  const logger = createLogger({
    level: "trace",
    destination: { write: (l: string) => void lines.push(l) },
  });
  return { logger, lines };
}

describe("PHI never reaches logs, audit summaries or outbox payloads", () => {
  it("replaces a PHI-like message, field, nested object and error at every level", () => {
    const { logger, lines } = capture();
    logger.info(CANARY_PHI);
    logger.info({ note: CANARY_PHI }, "with field");
    logger.info({ deep: { list: [{ t: CANARY_PHI }] } }, "nested");
    logger.error({ err: new Error(`failed for ${CANARY_PHI}`) }, "with error");
    logger.debug({ note: CANARY_PHI }, "debug does not bypass");
    logger.trace(CANARY_PHI);
    const out = lines.join("");
    expect(out).not.toContain("Canaryfield");
    expect(out).not.toContain("00987654");
    expect(out).toMatch(/\[REDACTED:PHI\.[A-Z_]+/);
  });

  it("leaves ordinary log lines alone", () => {
    const { logger, lines } = capture();
    logger.info({ route: "/users", statusCode: 200 }, "request completed");
    expect(JSON.parse(lines[0]!)).toMatchObject({ msg: "request completed", statusCode: 200 });
  });

  it("withholds PHI from audit summaries with a rule-id marker", () => {
    const db = new SqliteDatabase();
    migrate(db);
    db.transaction((tx) =>
      recordAudit(tx, {
        actorId: null,
        actorType: "system",
        action: "x",
        entityType: "y",
        outcome: "failed",
        before: { note: CANARY_PHI },
        after: [CANARY_PHI],
      }),
    );
    const row = JSON.stringify(
      db.raw.prepare("SELECT before_summary, after_summary FROM audit_event").all(),
    );
    expect(row).not.toContain("Canaryfield");
    expect(row).toContain("withheld");
  });

  it("rejects PHI in outbox payloads and stores nothing", () => {
    const db = new SqliteDatabase();
    migrate(db);
    expect(() =>
      db.transaction((tx) =>
        writeOutbox(tx, {
          type: "t",
          actor: { id: null, type: "system" },
          correlation_id: null,
          causation_id: null,
          idempotency_key: null,
          payload: { text: CANARY_PHI },
          provenance: {},
        }),
      ),
    ).toThrow(OutboxRejectedError);
    expect(db.raw.prepare("SELECT count(*) c FROM outbox_event").get()).toEqual({ c: 0 });
  });
});
