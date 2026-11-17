import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../../auth/token.js";
import { fetchCurrentUser } from "../../../lib/server-api.js";
import { AuditViewer } from "./audit-viewer.js";

// Visible only with audit.read; the API enforces the same rule on every call.
export default async function AuditPage() {
  const idToken = await serverIdToken();
  if (!idToken) redirect("/api/auth/signin");
  const me = await fetchCurrentUser(idToken);
  if (me === "unauthenticated") redirect("/api/auth/signin");
  if (me === "forbidden" || !me.permissions.includes("audit.read")) {
    return (
      <main>
        <h1>Forbidden</h1>
        <p>You do not have permission to read the audit trail.</p>
      </main>
    );
  }
  return <AuditViewer />;
}
