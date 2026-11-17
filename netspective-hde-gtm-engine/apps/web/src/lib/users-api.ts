// Browser-side client for the users API (contracts/users.openapi.yaml) and plain-language errors.

export const ROLE_LABELS = {
  gtm_operator: "GTM operator",
  research_analyst: "Research analyst",
  technical_sme_reviewer: "Technical SME reviewer",
  sales_service_lead: "Sales and service lead",
  campaign_approver: "Campaign approver",
  administrator: "Administrator",
  read_only_executive: "Read-only executive",
} as const;
export type RoleKey = keyof typeof ROLE_LABELS;
export const ROLE_KEYS = Object.keys(ROLE_LABELS) as RoleKey[];

export interface UserView {
  id: string;
  email: string;
  displayName?: string;
  status: "invited" | "active" | "deactivated";
  roles: RoleKey[];
  invitationExpiresAt: string | null;
  lastSignInAt: string | null;
  createdAt: string;
}

export interface UsersApi {
  list(): Promise<{ items: UserView[]; nextCursor: string | null }>;
  invite(
    body: { email: string; displayName?: string; roles: RoleKey[] },
    key: string,
  ): Promise<UserView>;
  setRoles(id: string, roles: RoleKey[], key: string): Promise<UserView>;
  deactivate(id: string, key: string): Promise<UserView>;
  reactivate(id: string, key: string): Promise<UserView>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problemType: string = "about:blank",
    detail?: string,
  ) {
    super(detail ?? `request failed (${status})`);
    this.name = "ApiError";
  }
}

/** A message safe to show a person: never the server's detail, a stack or a raw error. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.problemType === "urn:gtm:problem:last-administrator") {
      return "This would remove the last administrator. Assign another administrator first.";
    }
    if (error.status === 403) return "You do not have permission to do that.";
    if (error.status === 404) return "That user no longer exists.";
    if (error.status === 409)
      return "That change conflicts with the current state. Refresh and try again.";
    if (error.status === 400 || error.status === 422)
      return "Please check the details and try again.";
  }
  return "Something went wrong. Please try again.";
}

export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

async function call<T>(method: string, path: string, key?: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { type?: string };
    throw new ApiError(response.status, problem.type);
  }
  return (await response.json()) as T;
}

export const browserUsersApi: UsersApi = {
  list: () => call("GET", "/users"),
  invite: (body, key) => call("POST", "/users", key, body),
  setRoles: (id, roles, key) => call("PUT", `/users/${id}/roles`, key, { roles }),
  deactivate: (id, key) => call("POST", `/users/${id}/deactivate`, key),
  reactivate: (id, key) => call("POST", `/users/${id}/reactivate`, key),
};
