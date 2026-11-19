import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../auth/token.js";
import { fetchCurrentUser } from "../../lib/server-api.js";
import { SignalsView } from "./signals-view.js";

// Visible only with signals.read; the API enforces the same rule on every call.
export default async function SignalsPage() {
  const idToken = await serverIdToken();
  if (!idToken) redirect("/api/auth/signin");
  const me = await fetchCurrentUser(idToken);
  if (me === "unauthenticated") redirect("/api/auth/signin");
  if (me === "forbidden" || !me.permissions.includes("signals.read")) {
    return (
      <main>
        <h1>Forbidden</h1>
        <p>You do not have permission to view signals.</p>
      </main>
    );
  }
  return (
    <SignalsView
      canReview={me.permissions.includes("signals.review")}
      canRecord={me.permissions.includes("signals.record")}
    />
  );
}
