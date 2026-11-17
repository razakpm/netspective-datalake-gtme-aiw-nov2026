import type { ReactNode } from "react";
import { Nav } from "../components/nav.js";
import NoAccessPage from "./no-access/page.js";
import { serverIdToken } from "../auth/token.js";
import { fetchCurrentUser } from "../lib/server-api.js";

export const metadata = { title: "GTM Engine" };

// Server component: the navigation reflects permissions the API returned for this request. Hiding links
// is a convenience; the API enforces every permission (spec FR-006).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const idToken = await serverIdToken();
  const me = idToken ? await fetchCurrentUser(idToken) : "unauthenticated";
  const permissions = typeof me === "object" ? me.permissions : [];
  return (
    <html lang="en">
      <body>
        <Nav permissions={permissions} />
        {typeof me === "object" && permissions.length === 0 ? <NoAccessPage /> : children}
      </body>
    </html>
  );
}
