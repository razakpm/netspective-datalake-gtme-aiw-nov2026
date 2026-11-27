import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../../auth/token.js";
import { fetchCurrentUser } from "../../../lib/server-api.js";
import { WorkshopWorkspace } from "./workshop-workspace.js";

// One workshop: visible with workshops.read. The controls appear only for holders of each permission, and
// the API enforces every permission regardless.
export default async function WorkshopPage({ params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;
  return <WorkshopWorkspace id={id} permissions={me.permissions} />;
}
