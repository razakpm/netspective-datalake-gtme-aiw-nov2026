import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../../auth/token.js";
import { fetchCurrentUser } from "../../../lib/server-api.js";
import ForbiddenNotice from "./forbidden.js";
import { UsersAdmin } from "./users-admin.js";

// Visible only with users.manage; a direct visit without it shows the forbidden notice. The API
// enforces the same rule on every call.
export default async function UsersPage() {
  const idToken = await serverIdToken();
  if (!idToken) redirect("/api/auth/signin");
  const me = await fetchCurrentUser(idToken);
  if (me === "unauthenticated") redirect("/api/auth/signin");
  if (me === "forbidden" || !me.permissions.includes("users.manage")) return <ForbiddenNotice />;
  return <UsersAdmin />;
}
