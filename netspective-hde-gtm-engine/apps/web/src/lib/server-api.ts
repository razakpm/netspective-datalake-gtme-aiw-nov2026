import { loadWebConfig } from "../config.js";
import type { Principal } from "./principal.js";

// Server-side calls to the API with the user's ID token (never reachable from browser code).

export async function fetchCurrentUser(
  idToken: string,
): Promise<Principal | "forbidden" | "unauthenticated"> {
  const { apiBaseUrl } = loadWebConfig();
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  if (response.status === 403) return "forbidden";
  if (!response.ok) return "unauthenticated";
  return (await response.json()) as Principal;
}

export async function checkSession(idToken: string): Promise<number> {
  const { apiBaseUrl } = loadWebConfig();
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/session/check`, {
    headers: { authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  return response.status;
}
