import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../auth/token.js";
import { fetchCurrentUser } from "../../lib/server-api.js";
import { ClaimsView } from "./claims-view.js";

// Claim review queue: visible with claims.read. The API enforces the same permissions on every call;
// approve and reject controls only appear for designated approvers.
export default async function ClaimsPage() {
  const idToken = await serverIdToken();
  if (!idToken) redirect("/api/auth/signin");
  const me = await fetchCurrentUser(idToken);
  if (me === "unauthenticated") redirect("/api/auth/signin");
  if (me === "forbidden" || !me.permissions.includes("claims.read")) {
    return (
      <main>
        <h1>Forbidden</h1>
        <p>You do not have permission to view claims.</p>
      </main>
    );
  }
  return <ClaimsView permissions={me.permissions} userId={me.id} />;
}
