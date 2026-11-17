import NextAuth from "next-auth";
import { evaluateSession, loadSessionPolicy, type SessionState } from "./session-policy.js";

// Auth.js OIDC sign-in with a server-side (JWT cookie) session (task T047, research R-05). The ID token
// stays in the encrypted cookie and is forwarded by the server to the API; it is never exposed to
// browser code. There is no local password path (spec FR-002). Provider settings are configuration,
// so Google Workspace and Microsoft Entra are both possible (open question #8).

const policy = loadSessionPolicy();

declare module "next-auth/jwt" {
  interface JWT extends Partial<SessionState> {
    idToken?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    {
      id: "oidc",
      name: "Company sign-in",
      type: "oidc",
      ...(process.env["OIDC_ISSUER_URL"] ? { issuer: process.env["OIDC_ISSUER_URL"] } : {}),
      ...(process.env["OIDC_CLIENT_ID"] ? { clientId: process.env["OIDC_CLIENT_ID"] } : {}),
      ...(process.env["OIDC_CLIENT_SECRET"]
        ? { clientSecret: process.env["OIDC_CLIENT_SECRET"] }
        : {}),
    },
  ],
  session: { strategy: "jwt", maxAge: Math.floor(policy.absoluteMs / 1000) },
  callbacks: {
    jwt({ token, account }) {
      const now = Date.now();
      if (account?.id_token) {
        return { ...token, idToken: account.id_token, issuedAt: now, lastActivityAt: now };
      }
      const state =
        token.idToken !== undefined &&
        token.issuedAt !== undefined &&
        token.lastActivityAt !== undefined
          ? {
              idToken: token.idToken,
              issuedAt: token.issuedAt,
              lastActivityAt: token.lastActivityAt,
            }
          : null;
      // An expired or idle session is dropped: returning null ends it, so no later action is performed.
      if (evaluateSession(state, now, policy) !== "valid") return null;
      return { ...token, lastActivityAt: now };
    },
    // Roles and permissions are never put in the session: the API resolves them on every request.
    session({ session }) {
      return session;
    },
  },
});
