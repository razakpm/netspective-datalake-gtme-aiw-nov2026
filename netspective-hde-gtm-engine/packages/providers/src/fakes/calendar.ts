import { fail, ok, type ProviderResult } from "../interfaces/result.js";
import {
  endOf,
  type CalendarEvent,
  type CalendarEventRequest,
  type CalendarProvider,
} from "../interfaces/calendar.js";
import { guardedCall } from "../wrapper.js";

// In-memory calendar for tests and development (feature 007). Busy slots and failures are scripted.

export type FakeCalendarFailure =
  "unauthorised" | "rate_limited" | "provider_unavailable" | "timeout";

export class FakeCalendar implements CalendarProvider {
  readonly name = "fake-calendar";
  /** Every request received, for assertions. */
  readonly requests: CalendarEventRequest[] = [];
  readonly events = new Map<string, CalendarEventRequest>();
  private readonly busy: { start: number; end: number }[] = [];
  private failure: FakeCalendarFailure | undefined;
  private sequence = 0;

  addBusy(start: string, end: string): void {
    this.busy.push({ start: Date.parse(start), end: Date.parse(end) });
  }
  /** Every later call fails with this code until `recover`. */
  failWith(code: FakeCalendarFailure): void {
    this.failure = code;
  }
  recover(): void {
    this.failure = undefined;
  }

  async createEvent(request: CalendarEventRequest): Promise<ProviderResult<CalendarEvent>> {
    return guardedCall<CalendarEvent>({
      provider: this.name,
      operation: "createEvent",
      correlationId: request.correlationId ?? null,
      payload: { title: request.title, attendeeLabels: request.attendeeLabels },
      call: async () => {
        this.requests.push(request);
        if (this.failure) return this.failed(this.failure);
        const start = Date.parse(request.start);
        const end = Date.parse(endOf(request.start, request.durationMinutes));
        if (this.busy.some((b) => start < b.end && end > b.start)) return fail("conflict");
        const ref = `fake-event-${++this.sequence}`;
        this.events.set(ref, request);
        return ok({ ref, start: request.start });
      },
    });
  }

  async cancelEvent(ref: string): Promise<ProviderResult<{ ref: string }>> {
    if (this.failure) return this.failed(this.failure);
    if (!this.events.delete(ref)) return fail("not_found");
    return ok({ ref });
  }

  private failed(code: FakeCalendarFailure): ProviderResult<never> {
    return fail(code, code !== "unauthorised");
  }
}
