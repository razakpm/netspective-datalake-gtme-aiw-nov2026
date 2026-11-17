import { headers } from "next/headers.js";
import { getToken } from "next-auth/jwt";

// Reads the ID token from the encrypted session cookie on the server. It is deliberately not part of
// the session object returned to browsers.
export async function serverIdToken(): Promise<string | undefined> {
  const token = await getToken({
    req: { headers: await headers() } as never,
    secret: process.env["AUTH_SECRET"] ?? "",
    secureCookie: process.env["NODE_ENV"] === "production",
  });
  return token?.idToken;
}
