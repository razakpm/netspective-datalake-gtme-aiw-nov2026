import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  httpJwksFetcher,
  KeysUnavailableError,
  OidcVerifier,
  TokenInvalidError,
} from "../src/modules/identity/oidc.js";
import { FakeIssuer } from "../test-support/fake-oidc/issuer.js";
import { startFakeOidcServer, type FakeOidcServer } from "../test-support/fake-oidc/server.js";

const ISSUER = "http://fake-idp.example.org";
const AUDIENCE = "gtm-engine";
const alice = { sub: "idp|alice", email: "Alice@example.org", name: "Alice Example" };

let issuer: FakeIssuer;
let server: FakeOidcServer;
let clock = 1_000_000;
const now = () => clock;

function verifier(overrides: Partial<ConstructorParameters<typeof OidcVerifier>[0]> = {}) {
  return new OidcVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    fetchJwks: httpJwksFetcher(server.jwksUri, 500),
    now,
    cacheTtlMs: 1000,
    graceMs: 10_000,
    refreshCooldownMs: 0,
    ...overrides,
  });
}

beforeEach(async () => {
  clock = 1_000_000;
  issuer = await FakeIssuer.create({ issuer: ISSUER, audience: AUDIENCE });
  server = await startFakeOidcServer(issuer);
});
afterEach(async () => {
  await server.close();
});

describe("fake issuer", () => {
  it("only mints synthetic example.org identities", async () => {
    await expect(issuer.mint({ sub: "x", email: "real@company.com" })).rejects.toThrow(
      /example\.org/,
    );
  });

  it("refuses to run in production", async () => {
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      await expect(FakeIssuer.create({ issuer: ISSUER, audience: AUDIENCE })).rejects.toThrow(
        /production/,
      );
    } finally {
      if (previous === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previous;
    }
  });
});

describe("OIDC verification", () => {
  it("accepts a valid token and lower-cases the email", async () => {
    expect(await verifier().verify(await issuer.mint(alice))).toEqual({
      sub: "idp|alice",
      email: "alice@example.org",
      name: "Alice Example",
    });
  });

  it("rejects expired, wrong-audience, wrong-issuer and forged tokens", async () => {
    const v = verifier();
    for (const token of [
      await issuer.mint({ ...alice, expiresInSeconds: -60 }),
      await issuer.mint({ ...alice, audience: "someone-else" }),
      await issuer.mint({ ...alice, issuer: "http://evil.example.org" }),
      await issuer.mint({ ...alice, forge: true }),
    ]) {
      await expect(v.verify(token)).rejects.toBeInstanceOf(TokenInvalidError);
    }
  });

  it("rejects garbage, empty and oversized tokens", async () => {
    const v = verifier();
    for (const token of ["", "not.a.jwt", "x".repeat(9000)]) {
      await expect(v.verify(token)).rejects.toBeInstanceOf(TokenInvalidError);
    }
  });

  it("rejects an unsigned (alg none) token", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        sub: "x",
        email: "a@example.org",
        iss: ISSUER,
        aud: AUDIENCE,
        exp: 4_000_000_000,
      }),
    ).toString("base64url");
    await expect(verifier().verify(`${header}.${body}.`)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it("never exposes role claims: only sub, email and name are returned", async () => {
    const identity = await verifier().verify(await issuer.mint(alice));
    expect(Object.keys(identity).sort()).toEqual(["email", "name", "sub"]);
  });
});

describe("key availability", () => {
  it("returns KeysUnavailableError when the provider is down and nothing is cached", async () => {
    server.setAvailable(false);
    await expect(verifier().verify(await issuer.mint(alice))).rejects.toBeInstanceOf(
      KeysUnavailableError,
    );
  });

  it("keeps verifying with cached keys during an outage, within the grace period", async () => {
    const v = verifier();
    const token = await issuer.mint(alice);
    await v.verify(token);
    server.setAvailable(false);
    clock += 5_000; // past the cache TTL, inside the grace period
    await expect(v.verify(token)).resolves.toMatchObject({ sub: "idp|alice" });
  });

  it("fails with KeysUnavailableError once the grace period has passed", async () => {
    const v = verifier();
    const token = await issuer.mint(alice);
    await v.verify(token);
    server.setAvailable(false);
    clock += 11_000;
    await expect(v.verify(token)).rejects.toBeInstanceOf(KeysUnavailableError);
  });

  it("refreshes keys when a token is signed with an unknown key id (rotation)", async () => {
    let current = issuer;
    let fetches = 0;
    const v = verifier({
      cacheTtlMs: 10 * 60_000,
      fetchJwks: async () => {
        fetches += 1;
        return current.jwks();
      },
    });
    await v.verify(await issuer.mint(alice));
    expect(fetches).toBe(1);

    current = await FakeIssuer.create({ issuer: ISSUER, audience: AUDIENCE });
    await expect(v.verify(await current.mint(alice))).resolves.toMatchObject({ sub: "idp|alice" });
    expect(fetches).toBe(2);
  });

  it("limits forced refreshes for unknown key ids to one per cooldown", async () => {
    let fetches = 0;
    const v = verifier({
      refreshCooldownMs: 30_000,
      cacheTtlMs: 10 * 60_000,
      fetchJwks: async () => {
        fetches += 1;
        return issuer.jwks();
      },
    });
    const stranger = await FakeIssuer.create({ issuer: ISSUER, audience: AUDIENCE });
    for (let i = 0; i < 5; i++) {
      await expect(v.verify(await stranger.mint(alice))).rejects.toBeInstanceOf(TokenInvalidError);
    }
    expect(fetches).toBe(1);
  });
});
