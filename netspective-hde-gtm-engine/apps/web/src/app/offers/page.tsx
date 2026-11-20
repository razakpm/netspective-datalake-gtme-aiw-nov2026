import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../auth/token.js";
import { fetchCurrentUser } from "../../lib/server-api.js";
import { OffersView } from "./offers-view.js";

// Offer Workspace v1: visible with offers.read. The API enforces the same permissions on every call; the
// controls only appear for users who hold them.
export default async function OffersPage() {
  const idToken = await serverIdToken();
  if (!idToken) redirect("/api/auth/signin");
  const me = await fetchCurrentUser(idToken);
  if (me === "unauthenticated") redirect("/api/auth/signin");
  if (me === "forbidden" || !me.permissions.includes("offers.read")) {
    return (
      <main>
        <h1>Forbidden</h1>
        <p>You do not have permission to view offers.</p>
      </main>
    );
  }
  return <OffersView permissions={me.permissions} />;
}
