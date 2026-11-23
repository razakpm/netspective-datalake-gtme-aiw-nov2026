import type { ConsentState } from "@gtm/domain";

// Ports the routing context reads through, so `offers` never imports `engagement` (research R-01). The real
// implementations live in `engagement` and are wired at the composition root; the in-memory ones below
// serve tests and the period before the public forms exist.

export interface PriorInteractions {
  forAccount(
    accountId: string,
    contactId: string | null,
  ): { downloads: number; sessionRequests: number };
}

export interface ConsentReader {
  /** The latest consent record for the contact or the keyed email hash. */
  latest(who: { contactId: string | null; emailHash: string | null }): ConsentState;
}

export const NO_PRIOR_INTERACTIONS: PriorInteractions = {
  forAccount: () => ({ downloads: 0, sessionRequests: 0 }),
};

export const NO_CONSENT_RECORDS: ConsentReader = { latest: () => "none" };

/** An in-memory consent reader for tests. */
export class FakeConsentReader implements ConsentReader {
  private readonly byContact = new Map<string, ConsentState>();
  set(contactId: string, state: ConsentState): void {
    this.byContact.set(contactId, state);
  }
  latest(who: { contactId: string | null; emailHash: string | null }): ConsentState {
    return (who.contactId ? this.byContact.get(who.contactId) : undefined) ?? "none";
  }
}

/** An in-memory prior-interactions reader for tests. */
export class FakePriorInteractions implements PriorInteractions {
  downloads = 0;
  sessionRequests = 0;
  forAccount() {
    return { downloads: this.downloads, sessionRequests: this.sessionRequests };
  }
}

/** The port `engagement` calls to queue a follow-up recommendation (wired at the composition root). */
export interface Recommender {
  recommendForRequest(input: {
    accountId: string;
    contactId: string | null;
    requestId: string;
    correlationId: string | null;
  }): Promise<{ recommendationId: string; created: boolean }>;
}
