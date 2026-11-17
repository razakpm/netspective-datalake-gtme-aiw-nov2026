import type { Logger } from "pino";
import type { JobService } from "../modules/jobs/index.js";
import type { HandlerRegistry } from "./registry.js";

// Worker bootstrap (task T078): polls the job service and runs registered handlers. A throwing handler
// is recorded as a failed attempt and can never crash the process. Shutdown is graceful: no new job is
// claimed once stop() is called, and stop() resolves after the running job finishes.

export interface WorkerOptions {
  service: JobService;
  registry: HandlerRegistry;
  logger: Logger;
  pollMs?: number;
}

export class Worker {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> = Promise.resolve();
  private stopping = false;

  constructor(private readonly options: WorkerOptions) {}

  /** Process every job that is due now. Returns how many were handled. */
  async runOnce(): Promise<number> {
    const { service, registry, logger } = this.options;
    let handled = 0;
    while (!this.stopping) {
      const queues = registry.queues();
      if (queues.length === 0) break;
      const job = service.claimNext(queues);
      if (!job) break;
      handled += 1;
      const handler = registry.get(job.queue)!;
      try {
        await handler(job);
        service.complete(job.id);
      } catch (error) {
        try {
          service.fail(job.id, error);
        } catch (recordError) {
          logger.error({ err: recordError, jobId: job.id }, "could not record job failure");
        }
        // Error text is scrubbed by the logger; the job record holds the redacted version.
        logger.warn(
          { jobId: job.id, queue: job.queue, attempt: job.attempts },
          "job attempt failed",
        );
      }
    }
    return handled;
  }

  start(): void {
    const pollMs = this.options.pollMs ?? 1000;
    this.timer = setInterval(() => {
      this.running = this.running
        .then(() => this.runOnce().then(() => undefined))
        .catch((error: unknown) => {
          this.options.logger.error({ err: error }, "worker loop error");
        });
    }, pollMs);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
