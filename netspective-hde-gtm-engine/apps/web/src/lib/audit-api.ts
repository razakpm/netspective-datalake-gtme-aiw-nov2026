export interface AuditEventView {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorType: "human" | "ai" | "system";
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: "success" | "denied" | "failed";
  correlationId: string | null;
}

export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  correlationId?: string;
}

export interface AuditApi {
  list(filters: AuditFilters): Promise<{ items: AuditEventView[]; nextCursor: string | null }>;
}

export const browserAuditApi: AuditApi = {
  async list(filters) {
    const query = new URLSearchParams(
      Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    const response = await fetch(`/api/v1/audit-events?${query.toString()}`);
    if (!response.ok) throw new Error(`request failed (${response.status})`);
    return (await response.json()) as { items: AuditEventView[]; nextCursor: string | null };
  },
};
