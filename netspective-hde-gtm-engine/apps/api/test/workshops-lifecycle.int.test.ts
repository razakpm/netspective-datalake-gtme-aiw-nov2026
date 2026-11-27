import { describe, expect, it } from "vitest";
import { recordConsent } from "../src/modules/engagement/index.js";
import { HttpError } from "../src/http/errors.js";
import { buildWorkshopsHarness, type WorkshopsHarness } from "../test-support/workshops-harness.js";

// Feature 007 task T024 (quickstart V1 to V6): conversion, the lifecycle, booking by hand and through the
// calendar, participants and notices. The clock starts on Thursday 2026-11-19.
const AT = "2026-11-24T10:00:00.000Z";
const LATER = "2026-12-02T14:30:00.000Z";

async function problem(fn: () => unknown) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { status: error.status, codes: error.codes ?? [], detail: error.message };
  }
  throw new Error("expected a refusal");
}

async function converted(h: WorkshopsHarness, offer: 1 | 6 = 1) {
  const request = await h.linkedIntake(offer);
  return { request, workshop: h.workshops.convert(h.operator(), request.requestId) };
}
const move = (
  h: WorkshopsHarness,
  id: string,
  action: string,
  over: Record<string, unknown> = {},
) =>
  h.workshops.transition(h.operator(), id, {
    action,
    lockNo: h.workshops.get(h.operator(), id).lockNo,
    ...over,
  });
const bookings = (h: WorkshopsHarness) =>
  h.db.raw
    .prepare("SELECT id, state, session_date, source FROM offer_session_booking ORDER BY rowid")
    .all()
    .map((r) => ({ ...(r as Record<string, string>) }));

describe("conversion", () => {
  it("makes a requested workshop from a linked intake request, audited and announced (V1)", async () => {
    const h = buildWorkshopsHarness();
    for (const [offer, minutes] of [
      [1, 45],
      [6, 90],
    ] as const) {
      const { request, workshop } = await converted(h, offer);
      expect(workshop).toMatchObject({
        offerId: `offer-${offer}`,
        state: "requested",
        accountId: request.accountId,
        contactId: request.contactId,
        requestId: request.requestId,
        durationMinutes: minutes,
        lockNo: 1,
        scheduledAt: null,
        bookingRoute: null,
        participants: [],
      });
      expect(workshop.accountName).toBe(h.account(offer).name);
      expect(workshop.intake).toBeDefined();
      expect(workshop.history).toMatchObject([
        { fromState: null, toState: "requested", changedBy: "operator-1" },
      ]);
    }
    expect(h.outbox("workshop.requested")).toHaveLength(2);
    expect(h.audit("workshop.convert")).toHaveLength(2);
    expect(h.count("offer_session_booking")).toBe(0);
  });

  it("refuses a request that is unknown, unlinked or not a workshop intake (V2)", async () => {
    const h = buildWorkshopsHarness();
    const unlinked = await h.submitIntake(1);
    expect(await problem(() => h.workshops.convert(h.operator(), unlinked))).toMatchObject({
      status: 409,
      codes: ["request_not_linked"],
    });
    expect(await problem(() => h.workshops.convert(h.operator(), "missing"))).toMatchObject({
      status: 404,
    });
    const at = h.now().toISOString();
    h.db.raw
      .prepare(
        "INSERT INTO offer_request (id, offer_id, form_slug, kind, state, email_hash, account_id, contact_id, submitted_at) VALUES ('q-session','offer-5','ccda-to-fhir-mapping-decision-register','working_session','linked','eh',?,NULL,?)",
      )
      .run(h.account(1).id, at);
    expect(await problem(() => h.workshops.convert(h.operator(), "q-session"))).toMatchObject({
      status: 409,
      codes: ["offer_not_supported"],
    });
    expect(h.count("workshop")).toBe(0);
    expect(h.audit("workshop.convert.refused")).toHaveLength(3);
  });

  it("keeps one open workshop per request, and allows a new one after a no-show", async () => {
    const h = buildWorkshopsHarness();
    const { request, workshop } = await converted(h);
    expect(await problem(() => h.workshops.convert(h.operator(), request.requestId))).toMatchObject(
      { status: 409, codes: ["workshop_open"] },
    );
    await move(h, workshop.id, "book", { scheduledAt: AT });
    await move(h, workshop.id, "no_show", { note: "nobody joined" });
    const again = h.workshops.convert(h.operator(), request.requestId);
    expect(again.id).not.toBe(workshop.id);
    expect(h.workshops.get(h.operator(), workshop.id).state).toBe("no_show");
  });
});

describe("booking", () => {
  it("books by hand with the offer's length and a workshop booking (V3)", async () => {
    const h = buildWorkshopsHarness();
    const { workshop } = await converted(h, 6);
    const booked = await move(h, workshop.id, "book", { scheduledAt: AT });
    expect(booked).toMatchObject({
      state: "booked",
      bookingRoute: "manual",
      scheduledAt: AT,
      durationMinutes: 90,
      lockNo: 2,
    });
    expect(bookings(h)).toEqual([
      { id: booked.bookingId, state: "booked", session_date: "2026-11-24", source: "workshop" },
    ]);
    expect(h.calendar.requests).toEqual([]);
    expect(h.outbox("workshop.booked")).toEqual([
      { workshop_id: workshop.id, offer_id: "offer-6", reschedule: false },
    ]);
    expect(h.audit("workshop.book")[0]).toMatchObject({ actor_id: "operator-1" });
  });

  it("takes the session date from the business time zone", async () => {
    const h = buildWorkshopsHarness({ businessTimeZone: "America/New_York" });
    const { workshop } = await converted(h);
    await move(h, workshop.id, "book", { scheduledAt: "2026-11-24T02:00:00.000Z" });
    expect(bookings(h)[0]?.["session_date"]).toBe("2026-11-23");
  });

  it("books through the calendar with labels only", async () => {
    const h = buildWorkshopsHarness();
    const { workshop } = await converted(h);
    h.participants.add(h.operator(), workshop.id, {
      side: "buyer",
      displayName: "Integration Lead",
    });
    const booked = await move(h, workshop.id, "book", { scheduledAt: AT, via: "calendar" });
    expect(booked).toMatchObject({ state: "booked", bookingRoute: "calendar" });
    expect(h.calendar.requests).toEqual([
      expect.objectContaining({
        start: AT,
        durationMinutes: 45,
        attendeeLabels: ["Integration Lead"],
      }),
    ]);
    expect(JSON.stringify(h.calendar.requests)).not.toContain("@");
    expect(h.calendar.events.size).toBe(1);
  });

  it.each(["provider_unavailable", "conflict", "none"] as const)(
    "leaves the workshop requested when the calendar fails (%s), and booking by hand still works (V4)",
    async (mode) => {
      const h = buildWorkshopsHarness({ calendar: mode === "none" ? null : undefined });
      const { workshop } = await converted(h);
      if (mode === "conflict") h.calendar.addBusy(AT, LATER);
      if (mode === "provider_unavailable") h.calendar.failWith(mode);
      expect(
        await problem(() => move(h, workshop.id, "book", { scheduledAt: AT, via: "calendar" })),
      ).toMatchObject({
        status: mode === "provider_unavailable" ? 502 : 409,
        codes: ["calendar_failed"],
      });
      expect(h.workshops.get(h.operator(), workshop.id)).toMatchObject({
        state: "requested",
        lockNo: 1,
      });
      expect(h.count("offer_session_booking")).toBe(0);
      expect(h.outbox("workshop.booked")).toEqual([]);
      expect(h.audit("workshop.book.refused")).toHaveLength(1);
      expect((await move(h, workshop.id, "book", { scheduledAt: AT })).state).toBe("booked");
    },
  );

  it("makes no calendar event when the offer is full or the copy is stale", async () => {
    const h = buildWorkshopsHarness();
    const { workshop } = await converted(h, 6);
    h.fillCapacity("offer-6", 3);
    expect(
      await problem(() => move(h, workshop.id, "book", { scheduledAt: AT, via: "calendar" })),
    ).toMatchObject({ status: 409, codes: ["capacity_exhausted"] });
    expect(
      await problem(() =>
        h.workshops.transition(h.operator(), workshop.id, {
          action: "book",
          lockNo: 9,
          scheduledAt: "2026-12-02T10:00:00.000Z",
          via: "calendar",
        }),
      ),
    ).toMatchObject({ status: 409, codes: ["stale_version"] });
    expect(h.calendar.requests).toEqual([]);
  });

  it("refuses to book a withdrawn offer, but a booked session can still be held or cancelled", async () => {
    const h = buildWorkshopsHarness();
    const first = await converted(h, 6);
    await move(h, first.workshop.id, "book", { scheduledAt: AT });
    h.offerStatus.moveStatus(h.lead(), "offer-6", 1, "withdrawn", "no longer offered");
    expect(
      await problem(() =>
        move(h, first.workshop.id, "reschedule", { scheduledAt: LATER, note: "moved" }),
      ),
    ).toMatchObject({ status: 409, codes: ["offer_unavailable"] });
    expect((await move(h, first.workshop.id, "hold")).state).toBe("held");
    const second = await converted(h, 6);
    const refused = await problem(() => move(h, second.workshop.id, "book", { scheduledAt: AT }));
    expect(refused).toMatchObject({ status: 409, codes: ["offer_unavailable"] });
    expect(refused.detail).toContain("withdrawn");
    expect((await move(h, second.workshop.id, "cancel", { note: "offer withdrawn" })).state).toBe(
      "cancelled",
    );
  });
});

describe("the lifecycle", () => {
  it("holds, records a no-show and cancels, keeping capacity in step (V5)", async () => {
    const h = buildWorkshopsHarness();
    const one = (await converted(h, 1)).workshop;
    const two = (await converted(h, 6)).workshop;
    const three = (await converted(h, 6)).workshop;
    for (const w of [one, two, three]) await move(h, w.id, "book", { scheduledAt: AT });
    await move(h, one.id, "hold");
    await move(h, two.id, "no_show", { note: "nobody joined" });
    const cancelled = await move(h, three.id, "cancel", { note: "buyer asked" });
    expect(cancelled.history.at(-1)).toMatchObject({
      fromState: "booked",
      toState: "cancelled",
      note: "buyer asked",
    });
    expect(bookings(h).map((b) => b["state"])).toEqual(["held", "no_show", "cancelled"]);
    expect(h.outbox("workshop.held")).toEqual([{ workshop_id: one.id, offer_id: "offer-1" }]);
    expect(h.capacity.capacityStatus("offer-6", h.now()).used).toBe(1);
  });

  it("keeps the history of dates across a reschedule, which needs a reason (V6)", async () => {
    const h = buildWorkshopsHarness();
    const { workshop } = await converted(h);
    await move(h, workshop.id, "book", { scheduledAt: AT });
    expect(
      await problem(() => move(h, workshop.id, "reschedule", { scheduledAt: LATER })),
    ).toMatchObject({ status: 400, codes: ["note_required"] });
    const moved = await move(h, workshop.id, "reschedule", {
      scheduledAt: LATER,
      note: "buyer asked",
    });
    expect(moved).toMatchObject({ state: "booked", scheduledAt: LATER, lockNo: 3 });
    expect(moved.history.at(-1)).toMatchObject({
      fromState: "booked",
      toState: "booked",
      scheduledFrom: AT,
      scheduledTo: LATER,
    });
    expect(bookings(h)).toHaveLength(1);
    expect(bookings(h)[0]?.["session_date"]).toBe("2026-12-02");
    expect(h.outbox("workshop.booked").at(-1)).toMatchObject({ reschedule: true });
  });

  it("refuses a forbidden move, a missing time and a close without finalised findings", async () => {
    const h = buildWorkshopsHarness();
    const { workshop } = await converted(h);
    expect(await problem(() => move(h, workshop.id, "hold"))).toMatchObject({
      status: 409,
      codes: ["invalid_transition"],
    });
    expect(await problem(() => move(h, workshop.id, "book"))).toMatchObject({
      status: 400,
      codes: ["time_required"],
    });
    await move(h, workshop.id, "book", { scheduledAt: AT });
    await move(h, workshop.id, "hold");
    expect(await problem(() => move(h, workshop.id, "close", { note: "done" }))).toMatchObject({
      status: 409,
      codes: ["invalid_transition"],
    });
    expect(await problem(() => move(h, workshop.id, "record_findings"))).toMatchObject({
      status: 400,
    });
    expect(h.audit("workshop.close.refused")).toHaveLength(1);
  });

  it("refuses a stale copy", async () => {
    const h = buildWorkshopsHarness();
    const { workshop } = await converted(h);
    await move(h, workshop.id, "book", { scheduledAt: AT });
    expect(
      await problem(() =>
        h.workshops.transition(h.operator(), workshop.id, { action: "hold", lockNo: 1 }),
      ),
    ).toMatchObject({ status: 409, codes: ["stale_version"] });
  });

  it("changes the booking when the calendar fails on cancel or reschedule, and says so", async () => {
    const h = buildWorkshopsHarness();
    const a = (await converted(h, 1)).workshop;
    const b = (await converted(h, 6)).workshop;
    for (const w of [a, b]) await move(h, w.id, "book", { scheduledAt: AT, via: "calendar" });
    h.calendar.failWith("provider_unavailable");
    const cancelled = await move(h, a.id, "cancel", { note: "buyer asked" });
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.history.at(-1)?.note).toContain("calendar event needs attention");
    expect(cancelled.notices).toContain("calendar_needs_attention");
    const moved = await move(h, b.id, "reschedule", { scheduledAt: LATER, note: "buyer asked" });
    expect(moved).toMatchObject({ state: "booked", scheduledAt: LATER });
    expect(moved.notices).toContain("calendar_needs_attention");
    expect(bookings(h).map((x) => x["state"])).toEqual(["cancelled", "booked"]);
  });

  it("moves the calendar event on a reschedule and removes it on a cancel", async () => {
    const h = buildWorkshopsHarness();
    const { workshop } = await converted(h);
    await move(h, workshop.id, "book", { scheduledAt: AT, via: "calendar" });
    const moved = await move(h, workshop.id, "reschedule", {
      scheduledAt: "2026-11-24T10:15:00.000Z",
      note: "a little later",
    });
    expect(moved.bookingRoute).toBe("calendar");
    expect(moved.notices).toEqual([]);
    expect([...h.calendar.events.values()].map((e) => e.start)).toEqual([
      "2026-11-24T10:15:00.000Z",
    ]);
    await move(h, workshop.id, "cancel", { note: "buyer asked" });
    expect(h.calendar.events.size).toBe(0);
  });

  it("audits every move with who and when, and never the note's words", async () => {
    const h = buildWorkshopsHarness();
    const { workshop } = await converted(h);
    await move(h, workshop.id, "book", { scheduledAt: AT });
    await move(h, workshop.id, "cancel", { note: "zebra-reason from the buyer" });
    expect(h.audit("workshop.cancel")[0]).toMatchObject({
      actor_id: "operator-1",
      entity_id: workshop.id,
      outcome: "success",
    });
    expect(h.anyText(/zebra-reason/)).toBe(false);
    expect(await problem(() => move(h, workshop.id, "book", { scheduledAt: AT }))).toMatchObject({
      codes: ["invalid_transition"],
    });
    expect(h.audit("workshop.book.refused")).toHaveLength(1);
  });

  it("refuses a patient-like note whole", async () => {
    const h = buildWorkshopsHarness();
    const { workshop } = await converted(h);
    expect(
      await problem(() =>
        move(h, workshop.id, "cancel", { note: "Patient: Jordan Testcase, MRN: 00123456" }),
      ),
    ).toMatchObject({ status: 422, codes: ["phi_guard"] });
    expect(h.workshops.get(h.operator(), workshop.id).state).toBe("requested");
    expect(h.anyText(/Testcase/)).toBe(false);
  });
});

describe("access and reading", () => {
  it("lets readers read and nobody without the permission change anything", async () => {
    const h = buildWorkshopsHarness();
    const { request, workshop } = await converted(h);
    expect(h.workshops.list(h.reader())).toHaveLength(1);
    expect(h.workshops.get(h.analyst(), workshop.id).id).toBe(workshop.id);
    for (const actor of [h.reader(), h.analyst(), h.automated("ai"), h.automated("system")]) {
      expect(await problem(() => h.workshops.convert(actor, request.requestId))).toMatchObject({
        status: 403,
      });
      expect(
        await problem(() =>
          h.workshops.transition(actor, workshop.id, {
            action: "book",
            lockNo: 1,
            scheduledAt: AT,
          }),
        ),
      ).toMatchObject({ status: 403 });
    }
    expect(await problem(() => h.workshops.get(h.operator(), "missing"))).toMatchObject({
      status: 404,
    });
  });

  it("filters the list by offer, state and account, newest first", async () => {
    const h = buildWorkshopsHarness();
    const one = (await converted(h, 1)).workshop;
    h.advance(1000);
    const six = (await converted(h, 6)).workshop;
    const ids = (f: Record<string, string>) => h.workshops.list(h.reader(), f).map((w) => w.id);
    expect(ids({})).toEqual([six.id, one.id]);
    expect(ids({ offerId: "offer-1" })).toEqual([one.id]);
    expect(ids({ accountId: six.accountId })).toEqual([six.id]);
    expect(ids({ state: "booked" })).toEqual([]);
  });

  it("shows notices when the account or contact is suppressed or consent is withdrawn", async () => {
    const h = buildWorkshopsHarness();
    const { request, workshop } = await converted(h);
    await move(h, workshop.id, "book", { scheduledAt: AT });
    expect(h.workshops.get(h.operator(), workshop.id).notices).toEqual([]);
    h.suppression.add(h.administrator(), {
      scope: "account",
      accountId: request.accountId,
      reason: "asked not to be contacted",
    });
    recordConsent(h.db.raw, {
      requestId: request.requestId,
      contactId: request.contactId,
      emailHash: "eh",
      noticeVersionId: (
        h.db.raw.prepare("SELECT id FROM notice_version LIMIT 1").get() as { id: string }
      ).id,
      consentGiven: false,
      at: new Date(h.now().getTime() + 60_000).toISOString(),
    });
    const read = h.workshops.get(h.operator(), workshop.id);
    expect(read.notices).toEqual(
      expect.arrayContaining(["account_suppressed", "consent_withdrawn"]),
    );
    expect(read.state).toBe("booked");
  });
});

describe("participants", () => {
  it("adds and removes people by name and role, keeping removed ones", async () => {
    const h = buildWorkshopsHarness();
    const { request, workshop } = await converted(h);
    const buyer = h.participants.add(h.operator(), workshop.id, {
      side: "buyer",
      displayName: "Integration Lead",
      roleTitle: "Integration lead",
      contactId: request.contactId,
    });
    h.participants.add(h.operator(), workshop.id, {
      side: "delivery",
      displayName: "Delivery Engineer",
    });
    const removed = h.participants.remove(h.operator(), workshop.id, buyer.id);
    expect(removed.removedAt).not.toBeNull();
    expect(h.workshops.get(h.operator(), workshop.id).participants).toHaveLength(2);
    expect(
      await problem(() => h.participants.remove(h.operator(), workshop.id, buyer.id)),
    ).toMatchObject({ status: 409 });
    expect(h.audit("workshop.participant.add")).toHaveLength(2);
    expect(h.anyText(/Delivery Engineer|Integration Lead/)).toBe(false);
  });

  it("takes no email or phone number, no other account's contact and no patient-like text", async () => {
    const h = buildWorkshopsHarness();
    const { workshop } = await converted(h, 1);
    const other = await h.linkedIntake(6);
    const add = (input: Record<string, unknown>) =>
      h.participants.add(h.operator(), workshop.id, {
        side: "buyer",
        displayName: "Synthetic Person",
        ...input,
      });
    for (const input of [
      { displayName: "person@buyer.example" },
      { roleTitle: "call +1 (555) 010-0199" },
    ]) {
      expect(await problem(() => add(input))).toMatchObject({
        status: 422,
        codes: ["contact_detail_not_accepted"],
      });
    }
    for (const input of [{ email: "x" }, { phone: "x" }]) {
      expect(await problem(() => add(input))).toMatchObject({ status: 400 });
    }
    expect(await problem(() => add({ contactId: other.contactId }))).toMatchObject({
      status: 422,
      codes: ["contact_not_at_account"],
    });
    expect(
      await problem(() => add({ roleTitle: "Patient: Jordan Testcase, MRN: 00123456" })),
    ).toMatchObject({ status: 422, codes: ["phi_guard"] });
    expect(
      await problem(() =>
        h.participants.add(h.reader(), workshop.id, { side: "buyer", displayName: "Someone" }),
      ),
    ).toMatchObject({ status: 403 });
    expect(h.count("workshop_participant")).toBe(0);
  });
});
