import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../auth/token.js";
import { fetchCurrentUser } from "../../lib/server-api.js";
import { WorkshopsView } from "./workshops-view.js";

// Workshops: visible with workshops.read. The API enforces the permission on every call.
export default async function WorkshopsPage() {
  const idToken = await serverIdToken();
  if (!idToken) redirect("/api/auth/signin");
  const me = await fetchCurrentUser(idToken);
  if (me === "unauthenticated") redirect("/api/auth/signin");
  if (me === "forbidden" || !me.permissions.includes("workshops.read")) {
    return (
      <main>
        <h1>Forbidden</h1>
        <p>You do not have permission to view workshops.</p>
      </main>
    );
  }
  return <WorkshopsView />;
}
