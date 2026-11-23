import { loadWebConfig } from "../../../../config.js";
import type { FormDefinition } from "../../../../lib/public-api.js";
import { PublicForm } from "./public-form.js";

// The hosted public form (feature 006, task T068). It needs no session. The form definition, the approved
// notice and a form token come from the API on every request, so a token is never reused from a cache.
export const dynamic = "force-dynamic";

export default async function PublicOfferPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { apiBaseUrl } = loadWebConfig();
  const response = await fetch(
    `${apiBaseUrl}/api/v1/public/offers/${encodeURIComponent(slug)}/form`,
    {
      cache: "no-store",
    },
  ).catch(() => null);
  if (!response || response.status === 404) {
    return (
      <main>
        <h1>Page not found</h1>
        <p>We could not find that page.</p>
      </main>
    );
  }
  if (!response.ok) {
    return (
      <main>
        <h1>This form is not available yet</h1>
        <p>This form is not available yet. Please try again later.</p>
      </main>
    );
  }
  return <PublicForm form={(await response.json()) as FormDefinition} />;
}
