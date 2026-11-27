import type { ProviderResult } from "./result.js";

// Calendar provider interface (feature 007, research R-04). A provider is given a title, a start, a length
// and attendee LABELS (a role or a name), never an email address, so it can invite nobody.

export interface CalendarEventRequest {
  title: string;
  /** ISO-8601 date and time. */
  start: string;
  durationMinutes: number;
  attendeeLabels: string[];
  correlationId?: string | null | undefined;
}

export interface CalendarEvent {
  ref: string;
  start: string;
}

/** `conflict` means the slot is busy; every failure is a typed result, never a thrown exception. */
export interface CalendarProvider {
  readonly name: string;
  createEvent(request: CalendarEventRequest): Promise<ProviderResult<CalendarEvent>>;
  cancelEvent(ref: string, correlationId?: string | null): Promise<ProviderResult<{ ref: string }>>;
}

export const endOf = (start: string, durationMinutes: number): string =>
  new Date(Date.parse(start) + durationMinutes * 60_000).toISOString();
