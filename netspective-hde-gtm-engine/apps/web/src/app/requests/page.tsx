import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../auth/token.js";
import { fetchCurrentUser } from "../../lib/server-api.js";
import { RequestsView } from "./requests-view.js";

// Request inbox and notice versions: visible with requests.read or a notice permission. The API enforces the
// same permissions on every call; the controls only appear for users who hold them.
export default async function RequestsPage() {
  const idToken = await serverIdToken();
  if (!idToken) redirect("/api/auth/signin");
  const me = await fetchCurrentUser(idToken);
  if (me === "unauthenticated") redirect("/api/auth/signin");
  const allowed =
    me !== "forbidden" &&
    ["requests.read", "notices.manage", "notices.approve"].some((p) => me.permissions.includes(p));
  if (me === "forbidden" || !allowed) {
    return (
      <main>
        <h1>Forbidden</h1>
        <p>You do not have permission to view requests.</p>
      </main>
    );
  }
  return <RequestsView permissions={me.permissions} userId={me.id} />;
}
