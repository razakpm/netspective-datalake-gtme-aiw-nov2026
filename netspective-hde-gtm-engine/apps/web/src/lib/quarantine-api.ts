export interface QuarantineItemView {
  id: string;
  entryPoint: string;
  ruleIds: string[];
  guardVersion: string;
  status: "held" | "released" | "discarded";
  createdAt: string;
  heldUntil: string;
  decidedBy: string | null;
  decisionReason: string | null;
  contentPurged: boolean;
}

export interface QuarantineApi {
  list(): Promise<{ items: QuarantineItemView[] }>;
  viewContent(id: string, purpose: string): Promise<{ content: string }>;
  release(id: string, reason: string): Promise<QuarantineItemView>;
  discard(id: string, reason: string): Promise<QuarantineItemView>;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`request failed (${response.status})`);
  return (await response.json()) as T;
}

export const browserQuarantineApi: QuarantineApi = {
  list: () => call("GET", "/quarantine-items"),
  viewContent: (id, purpose) => call("POST", `/quarantine-items/${id}/content`, { purpose }),
  release: (id, reason) => call("POST", `/quarantine-items/${id}/release`, { reason }),
  discard: (id, reason) => call("POST", `/quarantine-items/${id}/discard`, { reason }),
};
