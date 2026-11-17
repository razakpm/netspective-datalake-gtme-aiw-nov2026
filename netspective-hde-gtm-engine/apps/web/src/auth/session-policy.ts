// Session lifetime policy (task T047, spec FR-054, SC-016). Defaults are hypotheses: 8 hours absolute
// and 30 minutes idle, both configurable. An expired or unconfirmed session performs no action.

export interface SessionPolicy {
  absoluteMs: number;
  idleMs: number;
}

export interface SessionState {
  idToken: string;
  issuedAt: number;
  lastActivityAt: number;
}

export type SessionEvaluation = "valid" | "absolute_expired" | "idle_expired" | "missing";

const HOUR = 3_600_000;
const MINUTE = 60_000;

function positive(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export function loadSessionPolicy(
  env: Record<string, string | undefined> = process.env,
): SessionPolicy {
  return {
    absoluteMs: positive(env, "SESSION_ABSOLUTE_HOURS", 8) * HOUR,
    idleMs: positive(env, "SESSION_IDLE_MINUTES", 30) * MINUTE,
  };
}

export function evaluateSession(
  session: SessionState | null | undefined,
  now: number,
  policy: SessionPolicy,
): SessionEvaluation {
  if (
    !session ||
    typeof session.idToken !== "string" ||
    !Number.isFinite(session.issuedAt) ||
    !Number.isFinite(session.lastActivityAt)
  ) {
    return "missing";
  }
  if (now - session.issuedAt >= policy.absoluteMs) return "absolute_expired";
  if (now - session.lastActivityAt >= policy.idleMs) return "idle_expired";
  return "valid";
}

export type GuardResult =
  | { action: "allow"; session: SessionState }
  | { action: "sign_out"; reason: "missing" | "absolute_expired" | "idle_expired" | "rejected" }
  | { action: "unavailable" };

/**
 * Decide what a server-side request may do. The API is asked only for sessions that are still inside
 * their lifetimes. A 401 or 403 (invalid token, deactivated user) signs the user out; anything that
 * stops the API from confirming the session fails closed.
 */
export async function guardSession(input: {
  session: SessionState | null | undefined;
  now: number;
  policy: SessionPolicy;
  /** Calls GET /auth/session/check with the ID token and returns the HTTP status. */
  checkSession: (idToken: string) => Promise<number>;
}): Promise<GuardResult> {
  const state = evaluateSession(input.session, input.now, input.policy);
  if (state !== "valid") return { action: "sign_out", reason: state };
  const session = input.session!;
  let status: number;
  try {
    status = await input.checkSession(session.idToken);
  } catch {
    return { action: "unavailable" };
  }
  if (status === 200)
    return { action: "allow", session: { ...session, lastActivityAt: input.now } };
  if (status === 401 || status === 403) return { action: "sign_out", reason: "rejected" };
  return { action: "unavailable" };
}
