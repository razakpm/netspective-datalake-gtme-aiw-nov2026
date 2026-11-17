import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from "jose";

// OIDC ID-token verification (task T042, research R-05). Verifies signature, issuer, audience and
// expiry against the provider's key set. Keys are cached; during a provider outage cached keys keep
// working for a grace period, so signed-in users continue until their token expires. Roles are never
// read from claims (they come from the database on every request). There is no password path (FR-002).

export interface VerifiedIdentity {
  sub: string;
  email: string;
  name: string | null;
}

/** The token is missing, malformed, forged, expired, or for another issuer or audience. */
export class TokenInvalidError extends Error {
  constructor(message = "token is not valid") {
    super(message);
    this.name = "TokenInvalidError";
  }
}

/** The provider's keys cannot be fetched and no usable cached copy remains (maps to 503). */
export class KeysUnavailableError extends Error {
  constructor() {
    super("identity provider keys are unavailable");
    this.name = "KeysUnavailableError";
  }
}

export type JwksFetcher = () => Promise<JSONWebKeySet>;

export interface OidcVerifierOptions {
  issuer: string;
  audience: string;
  fetchJwks: JwksFetcher;
  /** How long fetched keys are used before a refresh is attempted. */
  cacheTtlMs?: number;
  /** How long stale keys remain usable when refreshing fails. */
  graceMs?: number;
  /** Minimum gap between forced refreshes triggered by an unknown key id. */
  refreshCooldownMs?: number;
  now?: () => number;
}

export function httpJwksFetcher(jwksUri: string, timeoutMs = 3000): JwksFetcher {
  return async () => {
    const response = await fetch(jwksUri, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`jwks http ${response.status}`);
    return (await response.json()) as JSONWebKeySet;
  };
}

export class OidcVerifier {
  private keys: JSONWebKeySet | null = null;
  private fetchedAt = 0;
  private lastForcedRefresh = -Infinity;
  private readonly cacheTtlMs: number;
  private readonly graceMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(private readonly options: OidcVerifierOptions) {
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60_000;
    this.graceMs = options.graceMs ?? 24 * 60 * 60_000;
    this.cooldownMs = options.refreshCooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  async verify(token: string): Promise<VerifiedIdentity> {
    if (typeof token !== "string" || token.length === 0 || token.length > 8192) {
      throw new TokenInvalidError();
    }
    let keys = await this.currentKeys();
    try {
      return await this.check(token, keys);
    } catch (error) {
      if (error instanceof errors.JWKSNoMatchingKey && this.canForceRefresh()) {
        keys = await this.refresh();
        return this.check(token, keys).catch(rethrowInvalid);
      }
      return rethrowInvalid(error);
    }
  }

  private async check(token: string, keys: JSONWebKeySet): Promise<VerifiedIdentity> {
    const { payload } = await jwtVerify(token, createLocalJWKSet(keys), {
      issuer: this.options.issuer,
      audience: this.options.audience,
      algorithms: ["RS256", "ES256"],
      clockTolerance: 5,
      requiredClaims: ["sub", "exp"],
    });
    const email = payload["email"];
    if (typeof payload.sub !== "string" || typeof email !== "string" || email.length === 0) {
      throw new TokenInvalidError("token lacks subject or email");
    }
    const name = payload["name"];
    return {
      sub: payload.sub,
      email: email.toLowerCase(),
      name: typeof name === "string" ? name : null,
    };
  }

  private canForceRefresh(): boolean {
    return this.now() - this.lastForcedRefresh >= this.cooldownMs;
  }

  private async currentKeys(): Promise<JSONWebKeySet> {
    const age = this.now() - this.fetchedAt;
    if (this.keys && age < this.cacheTtlMs) return this.keys;
    try {
      return await this.refresh();
    } catch (error) {
      if (this.keys && age < this.graceMs) return this.keys;
      throw error;
    }
  }

  private async refresh(): Promise<JSONWebKeySet> {
    this.lastForcedRefresh = this.now();
    try {
      this.keys = await this.options.fetchJwks();
      this.fetchedAt = this.now();
      return this.keys;
    } catch {
      if (this.keys && this.now() - this.fetchedAt < this.graceMs) return this.keys;
      throw new KeysUnavailableError();
    }
  }
}

function rethrowInvalid(error: unknown): never {
  if (error instanceof KeysUnavailableError || error instanceof TokenInvalidError) throw error;
  throw new TokenInvalidError();
}
