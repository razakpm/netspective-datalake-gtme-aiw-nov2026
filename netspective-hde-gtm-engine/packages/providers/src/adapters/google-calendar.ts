import { fail, ok, type ProviderResult } from "../interfaces/result.js";
import {
  endOf,
  type CalendarEvent,
  type CalendarEventRequest,
  type CalendarProvider,
} from "../interfaces/calendar.js";
import { guardedCall, type ProviderCallLog } from "../wrapper.js";

// Google Calendar over its REST API (feature 007, research R-04, ADR-021). Optional and off unless an
// administrator switches it on. It refreshes an access token, asks free/busy, then inserts or deletes an
// event on one configured calendar. An event has a title, a start, an end and a description of attendee
// labels: never an attendee list, and `sendUpdates=none`, so Google cannot email anyone. Google does not
// refuse an overlapping insert, which is why free/busy is asked first. Two fixed hosts only; no response
// or request body is ever logged.

export interface GoogleCalendarOptions {
  calendarId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch?: typeof globalThis.fetch | undefined;
  timeoutMs?: number | undefined;
  log?: ((line: ProviderCallLog) => void) | undefined;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const EMAIL = /[^\s<>()[\]"',;:]+@[^\s<>()[\]"',;:]+/g;
const withoutEmail = (text: string): string => text.replace(EMAIL, "[removed]");

type Failure = ProviderResult<never>;

function failureFor(status: number): Failure {
  if (status === 401 || status === 403) return fail("unauthorised");
  if (status === 404 || status === 410) return fail("not_found");
  if (status === 429) return fail("rate_limited", true);
  if (status >= 500) return fail("provider_unavailable", true);
  return fail("provider_error");
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = "google-calendar";
  constructor(private readonly o: GoogleCalendarOptions) {}

  async createEvent(request: CalendarEventRequest): Promise<ProviderResult<CalendarEvent>> {
    const title = withoutEmail(request.title);
    const labels = request.attendeeLabels.map(withoutEmail);
    return this.guarded("createEvent", request.correlationId ?? null, { title, labels }, () =>
      this.withToken(async (token) => {
        const start = new Date(request.start).toISOString();
        const end = endOf(start, request.durationMinutes);

        const free = await this.send("POST", `${API}/freeBusy`, token, {
          timeMin: start,
          timeMax: end,
          items: [{ id: this.o.calendarId }],
        });
        if (!free.ok) return failureFor(free.status);
        const calendar = (
          free.body as { calendars?: Record<string, { busy?: unknown[]; errors?: unknown[] }> }
        ).calendars?.[this.o.calendarId];
        // A calendar we cannot read is not a free calendar.
        if (!calendar || (calendar.errors?.length ?? 0) > 0) return fail("calendar_unavailable");
        if ((calendar.busy?.length ?? 0) > 0) return fail("conflict");

        const made = await this.send("POST", `${this.eventsUrl()}?sendUpdates=none`, token, {
          summary: title,
          start: { dateTime: start },
          end: { dateTime: end },
          description: labels.length > 0 ? `Attendees: ${labels.join(", ")}` : "",
        });
        if (!made.ok) return failureFor(made.status);
        const ref = (made.body as { id?: unknown }).id;
        return typeof ref === "string" && ref !== "" ? ok({ ref, start }) : fail("provider_error");
      }),
    );
  }

  async cancelEvent(
    ref: string,
    correlationId: string | null = null,
  ): Promise<ProviderResult<{ ref: string }>> {
    return this.guarded("cancelEvent", correlationId, { ref }, () =>
      this.withToken(async (token) => {
        const gone = await this.send(
          "DELETE",
          `${this.eventsUrl()}/${encodeURIComponent(ref)}?sendUpdates=none`,
          token,
        );
        return gone.ok ? ok({ ref }) : failureFor(gone.status);
      }),
    );
  }

  private eventsUrl(): string {
    return `${API}/calendars/${encodeURIComponent(this.o.calendarId)}/events`;
  }

  private guarded<T>(
    operation: string,
    correlationId: string | null,
    payload: unknown,
    call: () => Promise<ProviderResult<T>>,
  ): Promise<ProviderResult<T>> {
    return guardedCall({
      provider: this.name,
      operation,
      correlationId,
      payload,
      log: this.o.log,
      call: async () => {
        try {
          return await call();
        } catch (error) {
          const name = (error as { name?: string }).name;
          return name === "TimeoutError" || name === "AbortError"
            ? fail("timeout", true)
            : fail("provider_unavailable", true);
        }
      },
    });
  }

  private async withToken<T>(
    use: (token: string) => Promise<ProviderResult<T>>,
  ): Promise<ProviderResult<T>> {
    const response = await this.fetch()(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.o.clientId,
        client_secret: this.o.clientSecret,
        refresh_token: this.o.refreshToken,
      }).toString(),
      signal: this.signal(),
      redirect: "error",
    });
    if (!response.ok) {
      // Google answers a bad grant with 400: that is a credential problem too.
      return response.status === 400 ? fail("unauthorised") : failureFor(response.status);
    }
    const token = ((await response.json()) as { access_token?: unknown }).access_token;
    return typeof token === "string" ? use(token) : fail("unauthorised");
  }

  private async send(
    method: "POST" | "DELETE",
    url: string,
    token: string,
    body?: unknown,
  ): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
    const response = await this.fetch()(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: this.signal(),
      redirect: "error",
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, body: response.status === 204 ? null : await response.json() };
  }

  private fetch(): typeof globalThis.fetch {
    return this.o.fetch ?? globalThis.fetch;
  }
  private signal(): AbortSignal {
    return AbortSignal.timeout(this.o.timeoutMs ?? 10_000);
  }
}
