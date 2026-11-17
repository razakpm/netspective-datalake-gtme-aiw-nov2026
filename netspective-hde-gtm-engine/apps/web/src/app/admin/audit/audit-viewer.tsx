"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  browserAuditApi,
  type AuditApi,
  type AuditEventView,
  type AuditFilters,
} from "../../../lib/audit-api.js";

// Read-only audit list (task T061). There are deliberately no edit or delete controls: audit events
// are append-only (spec FR-012).
export function AuditViewer({ api = browserAuditApi }: { api?: AuditApi }) {
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (active: AuditFilters) => {
      api
        .list(active)
        .then((page) => {
          setEvents(page.items);
          setError(null);
        })
        .catch(() => setError("Could not load the audit trail. Please try again."));
    },
    [api],
  );

  useEffect(() => load({}), [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    load(filters);
  }
  const field = (name: keyof AuditFilters, label: string) => (
    <label>
      {label}
      <input
        value={filters[name] ?? ""}
        onChange={(e) => setFilters({ ...filters, [name]: e.target.value })}
      />
    </label>
  );

  return (
    <section>
      <h1>Audit trail</h1>
      {error ? <p role="alert">{error}</p> : null}
      <form onSubmit={submit} aria-label="Filter audit events">
        {field("entityType", "Entity type")}
        {field("actorId", "Actor")}
        {field("correlationId", "Correlation ID")}
        <button type="submit">Apply filters</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.occurredAt}</td>
              <td>{e.actorId ?? e.actorType}</td>
              <td>{e.action}</td>
              <td>{e.entityType}</td>
              <td>{e.outcome}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
