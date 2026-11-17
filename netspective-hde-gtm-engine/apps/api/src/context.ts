import { AsyncLocalStorage } from "node:async_hooks";

// Request and job scoped context. The correlation ID lives here so log lines, audit events, outbox
// events, jobs and provider calls can all read it without it being passed through every function
// (spec FR-033).

export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
