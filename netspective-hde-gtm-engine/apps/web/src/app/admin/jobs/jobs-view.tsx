"use client";
import { useEffect, useState } from "react";
import {
  browserJobsApi,
  type JobsApi,
  type JobView,
  type QueueDepth,
} from "../../../lib/jobs-api.js";

// Read-only administrator view: failed jobs with redacted error details, and queue depth.
export function JobsView({ api = browserJobsApi }: { api?: JobsApi }) {
  const [failed, setFailed] = useState<JobView[]>([]);
  const [queues, setQueues] = useState<QueueDepth[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.list({ state: "failed" }), api.queues()])
      .then(([jobs, depth]) => {
        setFailed(jobs.items);
        setQueues(depth.items);
      })
      .catch(() => setError("Could not load jobs. Please try again."));
  }, [api]);

  return (
    <section>
      <h1>Jobs</h1>
      {error ? <p role="alert">{error}</p> : null}
      <h2>Queue depth</h2>
      <ul>
        {queues.map((q) => (
          <li key={q.queue}>
            {q.queue}: {q.queued + q.running} of {q.depthCap} in use ({q.failed} failed)
          </li>
        ))}
      </ul>
      <h2>Failed jobs</h2>
      {failed.length === 0 ? <p>No failed jobs.</p> : null}
      <ul>
        {failed.map((job) => (
          <li key={job.id}>
            <span>{job.queue}</span> <span>after {job.attempts} attempts</span>
            {job.lastError ? (
              <span>
                {" "}
                {job.lastError.code}: {job.lastError.message}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
