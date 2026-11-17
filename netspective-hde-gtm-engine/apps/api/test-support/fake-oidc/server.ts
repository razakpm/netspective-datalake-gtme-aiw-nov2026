import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FakeIssuer } from "./issuer.js";

// Serves the fake issuer's JWKS over http on localhost. `setAvailable(false)` simulates an identity
// provider outage (the endpoint answers 503).

export interface FakeOidcServer {
  jwksUri: string;
  setAvailable(available: boolean): void;
  close(): Promise<void>;
}

export async function startFakeOidcServer(issuer: FakeIssuer, port = 0): Promise<FakeOidcServer> {
  let available = true;
  const server: Server = createServer((req, res) => {
    if (!available) {
      res.writeHead(503).end();
      return;
    }
    if (req.url === "/.well-known/jwks.json") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(issuer.jwks()));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    jwksUri: `http://127.0.0.1:${actual}/.well-known/jwks.json`,
    setAvailable: (value) => {
      available = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
