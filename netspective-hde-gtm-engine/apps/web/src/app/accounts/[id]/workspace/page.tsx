import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../../../auth/token.js";
import { fetchCurrentUser } from "../../../../lib/server-api.js";
import { WorkspaceView } from "./workspace-view.js";

// Target Account Workspace v1: visible with research.read or hypotheses.read. The API enforces the same
// permissions on every call; the controls below only appear for users who hold them.
export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idToken = await serverIdToken();
  if (!idToken) redirect("/api/auth/signin");
  const me = await fetchCurrentUser(idToken);
  if (me === "unauthenticated") redirect("/api/auth/signin");
  if (
    me === "forbidden" ||
    !(me.permissions.includes("research.read") || me.permissions.includes("hypotheses.read"))
  ) {
    return (
      <main>
        <h1>Forbidden</h1>
        <p>You do not have permission to view this workspace.</p>
      </main>
    );
  }
  return <WorkspaceView accountId={id} permissions={me.permissions} />;
}
