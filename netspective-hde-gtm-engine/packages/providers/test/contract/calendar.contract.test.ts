import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GoogleCalendarProvider } from "../../src/adapters/google-calendar.js";
import { FakeCalendar } from "../../src/fakes/calendar.js";
import type { CalendarProvider } from "../../src/interfaces/calendar.js";

// Feature 007 task T023: one contract for the fake calendar and the Google adapter. The adapter runs with
// an injected fetch that replays synthetic shapes (tests/fixtures/calendar/google): no network.
const FIXTURES = join(import.meta.dirname, "../../../../tests/fixtures/calendar/google");
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as {
    response: { status: number; body: unknown };
  };

const CREDENTIALS = {
  calendarId: "workshops@calendar.example",
  clientId: "client-id.example",
  clientSecret: "synthetic-client-secret",
  refreshToken: "synthetic-refresh-token",
};
const SLOT = {
  title: "Workshop: Sender Onboarding Friction Map",
  start: "2026-12-01T10:00:00.000Z",
  durationMinutes: 45,
  attendeeLabels: ["Integration lead", "Delivery engineer"],
};

type Mode = "ok" | "busy" | "unauthorised" | "rate_limited" | "server_error" | "timeout";
interface Sent {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
}

function google(mode: Mode) {
  const sent: Sent[] = [];
  const lines: unknown[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    sent.push({
      method,
      url,
      body: String(init.body ?? ""),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    });
    if (mode === "timeout") throw new DOMException("The operation timed out", "TimeoutError");
    let name: string;
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      name = mode === "unauthorised" ? "token-401" : "token-success";
    } else if (url.endsWith("/freeBusy")) {
      name = mode === "busy" ? "freebusy-busy" : "freebusy-empty";
    } else if (mode === "rate_limited") name = "rate-limit-429";
    else if (mode === "server_error") name = "server-error-500";
    else name = method === "DELETE" ? "event-delete-success" : "event-insert-success";
    const { status, body } = fixture(name).response;
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  };
  const provider = new GoogleCalendarProvider({
    ...CREDENTIALS,
    fetch: fetch as typeof globalThis.fetch,
    log: (line) => lines.push(line),
  });
  return { provider: provider as CalendarProvider, sent, lines };
}

function fake(mode: Mode) {
  const provider = new FakeCalendar();
  if (mode === "busy") provider.addBusy(SLOT.start, "2026-12-01T11:00:00.000Z");
  else if (mode !== "ok")
    provider.failWith(mode === "server_error" ? "provider_unavailable" : mode);
  return { provider: provider as CalendarProvider };
}

describe.each([
  ["fake", fake],
  ["google", google],
] as const)("calendar contract: %s", (_name, build) => {
  it("creates an event with a reference and the confirmed start, then cancels it", async () => {
    const { provider } = build("ok");
    const created = await provider.createEvent(SLOT);
    expect(created).toMatchObject({ ok: true, value: { start: SLOT.start } });
    if (!created.ok) throw new Error("not created");
    expect(created.value.ref.length).toBeGreaterThan(0);
    expect(await provider.cancelEvent(created.value.ref)).toMatchObject({ ok: true });
  });
  it("reports a busy slot as a conflict", async () => {
    expect(await build("busy").provider.createEvent(SLOT)).toMatchObject({
      ok: false,
      error: { code: "conflict", retryable: false },
    });
  });
  it.each([
    ["unauthorised", false],
    ["rate_limited", true],
    ["server_error", true],
    ["timeout", true],
  ] as const)("returns a failed result for %s", async (mode, retryable) => {
    const result = await build(mode).provider.createEvent(SLOT);
    expect(result).toMatchObject({ ok: false, error: { retryable } });
    expect(JSON.stringify(result)).not.toMatch(/synthetic-/);
  });
  it("refuses a patient-like title before anything is sent", async () => {
    const built = build("ok");
    const result = await built.provider.createEvent({
      ...SLOT,
      title: "Patient: Jordan Testcase, MRN: 00123456",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "phi_blocked" } });
    if ("sent" in built) expect(built.sent).toEqual([]);
  });
});

describe("the Google adapter", () => {
  it("calls only the two Google hosts, in the order token, free/busy, insert", async () => {
    const g = google("ok");
    await g.provider.createEvent(SLOT);
    await g.provider.cancelEvent("syntheticevent0001");
    expect(
      g.sent.map((s) => `${s.method} ${new URL(s.url).host}${new URL(s.url).pathname}`),
    ).toEqual([
      "POST oauth2.googleapis.com/token",
      "POST www.googleapis.com/calendar/v3/freeBusy",
      "POST www.googleapis.com/calendar/v3/calendars/workshops%40calendar.example/events",
      "POST oauth2.googleapis.com/token",
      "DELETE www.googleapis.com/calendar/v3/calendars/workshops%40calendar.example/events/syntheticevent0001",
    ]);
  });
  it("asks about the slot's own window", async () => {
    const g = google("ok");
    await g.provider.createEvent(SLOT);
    expect(JSON.parse(g.sent[1]!.body)).toEqual({
      timeMin: "2026-12-01T10:00:00.000Z",
      timeMax: "2026-12-01T10:45:00.000Z",
      items: [{ id: CREDENTIALS.calendarId }],
    });
  });
  it("inserts nothing when the slot is busy", async () => {
    const g = google("busy");
    await g.provider.createEvent(SLOT);
    expect(g.sent.some((s) => s.url.includes("/events"))).toBe(false);
  });
  it("treats a calendar it cannot read as a failure, not as free", async () => {
    const sent: string[] = [];
    const provider = new GoogleCalendarProvider({
      ...CREDENTIALS,
      fetch: (async (input: string | URL | Request) => {
        const url = String(input);
        sent.push(url);
        const { status, body } = fixture(
          url.includes("oauth2") ? "token-success" : "freebusy-calendar-error",
        ).response;
        return new Response(JSON.stringify(body), { status });
      }) as typeof globalThis.fetch,
    });
    expect(await provider.createEvent(SLOT)).toMatchObject({
      ok: false,
      error: { code: "calendar_unavailable" },
    });
    expect(sent.some((url) => url.includes("/events"))).toBe(false);
  });
  it("never sends an attendee list or an email address, and never lets Google notify anyone", async () => {
    const g = google("ok");
    await g.provider.createEvent({
      ...SLOT,
      title: "Workshop for lead@buyer.example",
      attendeeLabels: ["Integration lead", "someone@buyer.example"],
    });
    await g.provider.cancelEvent("syntheticevent0001");
    for (const s of g.sent) {
      expect(s.body).not.toContain("attendees");
      expect(s.body).not.toContain("buyer.example");
      expect(s.url).not.toContain("buyer.example");
    }
    const events = g.sent.filter((s) => new URL(s.url).pathname.includes("/events"));
    expect(events).toHaveLength(2);
    for (const s of events) expect(new URL(s.url).searchParams.get("sendUpdates")).toBe("none");
    const inserted = JSON.parse(events[0]!.body) as Record<string, unknown>;
    expect(Object.keys(inserted).sort()).toEqual(["description", "end", "start", "summary"]);
    expect(inserted["description"]).toContain("Integration lead");
  });
  it("reports a missing event on cancel as a failure", async () => {
    const provider = new GoogleCalendarProvider({
      ...CREDENTIALS,
      fetch: (async (input: string | URL | Request) => {
        const url = String(input);
        const { status, body } = fixture(
          url.includes("oauth2") ? "token-success" : "event-delete-404",
        ).response;
        return new Response(JSON.stringify(body), { status });
      }) as typeof globalThis.fetch,
    });
    expect(await provider.cancelEvent("gone")).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
  it("keeps tokens and credentials out of results and logs", async () => {
    for (const mode of ["ok", "unauthorised", "server_error"] as const) {
      const g = google(mode);
      const result = await g.provider.createEvent(SLOT);
      const visible = JSON.stringify([result, g.lines]);
      for (const secret of [...Object.values(CREDENTIALS), "synthetic-access-token"]) {
        expect(visible).not.toContain(secret);
      }
      expect(visible).not.toContain("Integration lead");
      expect(g.lines.length).toBe(1);
    }
  });
});
