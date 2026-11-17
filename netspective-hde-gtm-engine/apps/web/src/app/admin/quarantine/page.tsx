import { redirect } from "next/navigation.js";
import { serverIdToken } from "../../../auth/token.js";
import { fetchCurrentUser } from "../../../lib/server-api.js";
import { QuarantineReview } from "./quarantine-review.js";

// Only for quarantine.review; the API enforces the same rule on every call.
export default async function QuarantinePage() {
  const idToken = await serverIdToken();
  if (!idToken) redirect("/api/auth/signin");
  const me = await fetchCurrentUser(idToken);
  if (me === "unauthenticated") redirect("/api/auth/signin");
  if (me === "forbidden" || !me.permissions.includes("quarantine.review")) {
    return (
      <main>
        <h1>Forbidden</h1>
        <p>You do not have permission to review quarantined content.</p>
      </main>
    );
  }
  return <QuarantineReview />;
}
