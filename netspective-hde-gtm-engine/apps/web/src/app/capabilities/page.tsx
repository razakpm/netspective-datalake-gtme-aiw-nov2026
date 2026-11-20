import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../auth/token.js";
import { fetchCurrentUser } from "../../lib/server-api.js";
import { CapabilitiesView } from "./capabilities-view.js";

// Capability catalogue: visible with capabilities.read. The API enforces the same permissions on every call.
export default async function CapabilitiesPage() {
  const idToken = await serverIdToken();
  if (!idToken) redirect("/api/auth/signin");
  const me = await fetchCurrentUser(idToken);
  if (me === "unauthenticated") redirect("/api/auth/signin");
  if (me === "forbidden" || !me.permissions.includes("capabilities.read")) {
    return (
      <main>
        <h1>Forbidden</h1>
        <p>You do not have permission to view capabilities.</p>
      </main>
    );
  }
  return <CapabilitiesView permissions={me.permissions} />;
}
