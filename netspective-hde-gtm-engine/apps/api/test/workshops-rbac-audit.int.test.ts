import { FOUNDATION_ROLE_PERMISSIONS, ROLE_KEYS, type Permission } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";
import { offer1Findings } from "../test-support/workshop-findings.js";
import { seedLinkedIntake } from "../test-support/workshop-seed.js";

// Feature 007 task T071 (quickstart V29 and V30; spec FR-035, FR-036, constitution IX): every workshop route
// refuses every role without its permission with one audited refusal; no automated actor moves anything; and
// no text a person typed reaches the audit trail, an event, a guard record or an invocation record.
let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});

const READ: Permission = "workshops.read";
const EDIT: Permission = "workshops.edit";
const ROUTES: Record<string, Permission> = {
  "GET /api/v1/workshops": READ,
  "POST /api/v1/workshops": EDIT,
  "GET /api/v1/workshops/:id": READ,
  "POST /api/v1/workshops/:id/transition": EDIT,
  "POST /api/v1/workshops/:id/participants": EDIT,
  "DELETE /api/v1/workshops/:id/participants/:participantId": EDIT,
  "GET /api/v1/workshops/:id/artifacts": READ,
  "POST /api/v1/workshops/:id/artifacts": EDIT,
  "POST /api/v1/workshop-artifacts/:artifactId/decision": "quarantine.review",
  "GET /api/v1/workshop-artifacts/:artifactId/content": READ,
  "GET /api/v1/workshops/:id/brief": READ,
  "POST /api/v1/workshops/:id/brief": EDIT,
  "POST /api/v1/workshops/:id/brief/:briefId/review": EDIT,
  "GET /api/v1/workshops/:id/findings": READ,
  "PUT /api/v1/workshops/:id/findings": EDIT,
  "POST /api/v1/workshops/:id/findings/finalise": EDIT,
  "POST /api/v1/workshops/:id/findings/suggest": EDIT,
  "GET /api/v1/workshops/:id/output": READ,
  "POST /api/v1/workshops/:id/output": EDIT,
  "PUT /api/v1/workshops/:id/output": EDIT,
  "POST /api/v1/workshops/:id/output/approve": "workshops.output.approve",
  "POST /api/v1/workshops/:id/output/share": EDIT,
  "GET /api/v1/workshops/:id/output/pdf": READ,
  "GET /api/v1/workshops/:id/effort": READ,
  "POST /api/v1/workshops/:id/effort": EDIT,
  "GET /api/v1/workshop-effort-summary": READ,
};

/** A body that passes shape checks, so the refusal is about the permission alone. */
const BODIES: Record<string, unknown> = {
  "POST /api/v1/workshops": { requestId: "any" },
  "POST /api/v1/workshops/:id/transition": { action: "hold", lockNo: 1 },
  "POST /api/v1/workshops/:id/participants": { side: "buyer", displayName: "Someone" },
  "POST /api/v1/workshops/:id/artifacts": {
    kind: "specification",
    title: "Specification",
    reference: "Shared drive",
  },
  "POST /api/v1/workshop-artifacts/:artifactId/decision": {
    decision: "discard",
    reason: "Not wanted",
  },
  "POST /api/v1/workshops/:id/findings/suggest": { notes: "Synthetic notes long enough to pass." },
  "PUT /api/v1/workshops/:id/findings": { content: {} },
  "PUT /api/v1/workshops/:id/output": { baseRevisionNo: 1, sections: {} },
  "POST /api/v1/workshops/:id/output/share": { how: "other" },
  "POST /api/v1/workshops/:id/effort": { prepHours: 1, sessionHours: 1, people: 1 },
};

const count = (table: string, where = "1=1") =>
  (fx.db.raw.prepare(`SELECT count(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c;
const actor = (actorType: "human" | "ai" | "system" = "human") => ({
  userId: "seed-lead",
  actorType,
  correlationId: null,
  permissions: FOUNDATION_ROLE_PERMISSIONS.administrator,
  now: () => fx.clock.now,
});
const makeWorkshop = () =>
  fx.workshops.workshops.convert(actor(), seedLinkedIntake(fx.db).requestId);

describe("permissions", () => {
  it("has an entry for every workshop route", () => {
    const registered = fx.routes
      .filter((r) => r.url.includes("/workshop") && !["HEAD", "OPTIONS"].includes(r.method))
      .map((r) => `${r.method} ${r.url}`);
    expect(registered.sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it("refuses every role without the permission, once and audited", async () => {
    const { id } = makeWorkshop();
    const tokens = new Map<string, string>();
    for (const role of ROLE_KEYS) {
      tokens.set(role, (await fx.makeUser(`${role}@example.org`, [role])).token);
    }
    let checked = 0;
    let key = 0;
    for (const [route, permission] of Object.entries(ROUTES)) {
      const [method, path] = route.split(" ") as ["GET", string];
      const url = path.replace(":id", id).replace(/:(participantId|artifactId|briefId)/, "missing");
      for (const role of ROLE_KEYS) {
        if (FOUNDATION_ROLE_PERMISSIONS[role].includes(permission)) continue;
        const denied = count("audit_event", "outcome = 'denied'");
        const rows = count("audit_event");
        const res = await fx.app.inject({
          method,
          url,
          headers: {
            authorization: `Bearer ${tokens.get(role)!}`,
            "idempotency-key": `rbac-key-${++key}-padding`,
          },
          payload: BODIES[route] as object | undefined,
        });
        expect(res.statusCode, `${role} ${route}`).toBe(403);
        expect(count("audit_event", "outcome = 'denied'") - denied, `${role} ${route}`).toBe(1);
        expect(count("audit_event") - rows, `${role} ${route}`).toBe(1);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(count("workshop_participant")).toBe(0);
    expect(count("workshop_artifact")).toBe(0);
  });

  it.each(["ai", "system"] as const)(
    "never lets an %s actor move, record, finalise or approve, whatever it holds",
    async (actorType) => {
      const { id } = makeWorkshop();
      const robot = actor(actorType);
      const w = fx.workshops;
      const attempts: (() => unknown)[] = [
        () => w.workshops.convert(robot, seedLinkedIntake(fx.db).requestId),
        () =>
          w.workshops.transition(robot, id, {
            action: "cancel",
            lockNo: 1,
            note: "automated",
          }),
        () => w.participants.add(robot, id, { side: "buyer", displayName: "Robot" }),
        () => w.artifacts.record(robot, id, { kind: "timeline", title: "T1", reference: "r" }),
        () => w.briefs.generate(robot, id),
        () => w.findings.save(robot, id, { content: offer1Findings() }),
        () => w.findings.finalise(robot, id),
        () => w.suggest.suggest(robot, id, { notes: "Synthetic notes long enough to pass." }),
        () => w.outputs.generate(robot, id),
        () => w.outputs.approve(robot, id),
        () => w.outputs.share(robot, id, { how: "other" }),
        () => w.effort.record(robot, id, { prepHours: 1, sessionHours: 1, people: 1 }),
      ];
      for (const [i, attempt] of attempts.entries()) {
        const outcome = await Promise.resolve()
          .then(attempt)
          .then(
            () => "allowed",
            (e: unknown) => (e instanceof HttpError ? e.status : String(e)),
          );
        expect(outcome, `attempt ${i}`).toBe(403);
      }
      expect(w.workshops.get(actor(), id)).toMatchObject({ state: "requested", lockNo: 1 });
    },
  );
});

describe("what is recorded about a change", () => {
  const MARK = {
    participant: "Quillon Participantmark",
    note: "zebranote from the buyer",
    title: "Titlemark specification",
    reference: "Referencemark drive",
    finding: "Findingmark review waits",
    waiver: "Waivermark only two sources",
    summary: "Summarymark page text",
    share: "Sharemark at the follow-up",
    notes: "Notesmark pasted session notes with enough length.",
  };

  it("writes one audit record per change and never the words", async () => {
    const w = fx.workshops;
    const a = actor();
    const { id } = makeWorkshop();
    const step = async (action: string, change: () => unknown) => {
      const before = count("audit_event", `action = '${action}'`);
      await change();
      expect(count("audit_event", `action = '${action}'`) - before, action).toBe(1);
    };
    await step("workshop.participant.add", () =>
      w.participants.add(a, id, { side: "buyer", displayName: MARK.participant }),
    );
    await step("workshop.book", () =>
      w.workshops.transition(a, id, {
        action: "book",
        lockNo: 1,
        scheduledAt: fx.clock.now.toISOString(),
      }),
    );
    await step("workshop.reschedule", () =>
      w.workshops.transition(a, id, {
        action: "reschedule",
        lockNo: 2,
        scheduledAt: new Date(fx.clock.now.getTime() + 86_400_000).toISOString(),
        note: MARK.note,
      }),
    );
    await step("workshop.artifact.record", () =>
      w.artifacts.record(a, id, {
        kind: "specification",
        title: MARK.title,
        reference: MARK.reference,
      }),
    );
    await step("workshop.brief.generate", () => w.briefs.generate(a, id));
    await step("workshop.hold", () => w.workshops.transition(a, id, { action: "hold", lockNo: 3 }));
    const findings = offer1Findings();
    findings.delaySources[0]!.description = MARK.finding;
    findings.delaySources.pop();
    await step("workshop.findings.save", () => w.findings.save(a, id, { content: findings }));
    await step("workshop.findings.finalise", () =>
      w.findings.finalise(a, id, { waiverReason: MARK.waiver }),
    );
    fx.workshopRules.push({
      task: "synthesis",
      whenTextIncludes: [id],
      respond: {
        entityIds: { workshopId: id, accountId: w.workshops.get(a, id).accountId },
        items: [],
        confidence: "low",
        rationale: "Nothing found.",
        reviewStatus: "unreviewed",
      },
      repeat: true,
    });
    await step("workshop.findings.suggest", () => w.suggest.suggest(a, id, { notes: MARK.notes }));
    const draft = w.outputs.generate(a, id);
    const { title, nextStep, inScope, outOfScope } = draft.sections;
    await step("workshop.output.edit", () =>
      w.outputs.edit(a, id, {
        baseRevisionNo: 1,
        sections: { title, summary: MARK.summary, nextStep, inScope, outOfScope },
      }),
    );
    await step("workshop.output.approve", () => w.outputs.approve(a, id));
    await step("workshop.output.share", () =>
      w.outputs.share(a, id, { how: "other", note: MARK.share }),
    );
    await step("workshop.effort.record", () =>
      w.effort.record(a, id, { prepHours: 1, sessionHours: 1, people: 1 }),
    );

    const recorded = JSON.stringify(
      ["audit_event", "outbox_event", "phi_guard_decision", "ai_invocation"].map((table) =>
        fx.db.raw.prepare(`SELECT * FROM ${table}`).all(),
      ),
    );
    for (const mark of Object.values(MARK)) {
      expect(recorded, mark).not.toContain(mark.split(" ")[0]);
    }
    expect(fx.logs.join("\n")).not.toMatch(/mark\b/);
  });
});
