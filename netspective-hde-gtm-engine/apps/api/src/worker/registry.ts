import type { ClaimedJob } from "../modules/jobs/index.js";

// Handler registry (task T078). Handlers MUST be idempotent by job key: a job can run more than once if a
// worker dies between finishing the work and recording success (at-least-once delivery).

export type JobHandler = (job: ClaimedJob) => void | Promise<void>;

export class HandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(queue: string, handler: JobHandler): void {
    if (this.handlers.has(queue))
      throw new Error(`a handler is already registered for queue "${queue}"`);
    this.handlers.set(queue, handler);
  }

  get(queue: string): JobHandler | undefined {
    return this.handlers.get(queue);
  }

  queues(): string[] {
    return [...this.handlers.keys()];
  }
}
