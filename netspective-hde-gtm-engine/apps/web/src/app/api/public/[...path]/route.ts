import { loadWebConfig } from "../../../../config.js";

// Unauthenticated same-origin proxy for the public forms (feature 006, task T068). It forwards only to the
// public group of the API, for the form, the request and the download, and passes on neither cookies nor an
// authorisation header. The existing /api/v1 proxy needs a session and is unchanged.

const ALLOWED = /^(offers\/[a-z0-9-]{1,100}\/(form|requests)|downloads\/[A-Za-z0-9_.-]{1,400})$/;

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const joined = path.join("/");
  if (!ALLOWED.test(joined)) return new Response(null, { status: 404 });
  const isRequest = joined.endsWith("/requests");
  if ((request.method === "POST") !== isRequest) return new Response(null, { status: 405 });
  const { apiBaseUrl } = loadWebConfig();
  const body = request.method === "POST" ? await request.text() : undefined;
  const upstream = await fetch(`${apiBaseUrl}/api/v1/public/${joined}`, {
    method: request.method,
    headers: body ? { "content-type": "application/json" } : {},
    ...(body ? { body } : {}),
    cache: "no-store",
  });
  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-disposition",
    "content-length",
    "retry-after",
    "cache-control",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
}

export { forward as GET, forward as POST };
