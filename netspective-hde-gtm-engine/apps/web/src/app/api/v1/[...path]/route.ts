import { getToken } from "next-auth/jwt";
import { loadWebConfig } from "../../../../config.js";

// Same-origin proxy: the browser calls /api/v1/*, this handler attaches the ID token from the
// server-side session and forwards to the API. The API still enforces every permission.

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const token = await getToken({
    req: request as never,
    secret: process.env["AUTH_SECRET"] ?? "",
    secureCookie: process.env["NODE_ENV"] === "production",
  });
  if (!token?.idToken) return new Response(null, { status: 401 });

  const { path } = await context.params;
  const { apiBaseUrl } = loadWebConfig();
  const incoming = new URL(request.url);
  const idempotencyKey = request.headers.get("idempotency-key");
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  const upstream = await fetch(
    `${apiBaseUrl}/api/v1/${path.map(encodeURIComponent).join("/")}${incoming.search}`,
    {
      method: request.method,
      headers: {
        authorization: `Bearer ${token.idToken}`,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(body ? { body } : {}),
      cache: "no-store",
    },
  );
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
