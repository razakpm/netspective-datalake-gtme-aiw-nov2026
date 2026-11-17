export interface JobView {
  id: string;
  queue: string;
  idempotencyKey: string;
  state: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  scheduledBy: string;
  lastError: { code: string; message: string; stack_hash: string } | null;
  correlationId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface QueueDepth {
  queue: string;
  queued: number;
  running: number;
  failed: number;
  depthCap: number;
}

export interface JobsApi {
  list(filters: { state?: JobView["state"] }): Promise<{ items: JobView[] }>;
  queues(): Promise<{ items: QueueDepth[] }>;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`);
  if (!response.ok) throw new Error(`request failed (${response.status})`);
  return (await response.json()) as T;
}

export const browserJobsApi: JobsApi = {
  list: (filters) => get(`/jobs${filters.state ? `?state=${filters.state}` : ""}`),
  queues: () => get("/jobs/queues"),
};
