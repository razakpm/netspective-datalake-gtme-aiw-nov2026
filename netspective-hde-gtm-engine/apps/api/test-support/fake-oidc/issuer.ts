import { exportJWK, generateKeyPair, SignJWT, type JWK, type CryptoKey } from "jose";

// Fake OIDC issuer for tests and local development (task T041). It holds a throw-away key pair, mints
// tokens for synthetic identities only (example.org), and serves a JWKS. It is never used in production:
// the config module refuses USE_FAKE_OIDC there, and this module refuses to run when NODE_ENV=production.

export interface FakeIssuerOptions {
  issuer: string;
  audience: string;
}

export interface MintOptions {
  sub: string;
  email: string;
  name?: string;
  /** Seconds from now until expiry. Negative mints an already-expired token. */
  expiresInSeconds?: number;
  audience?: string;
  issuer?: string;
  /** Sign with a different, unpublished key to simulate a forged token. */
  forge?: boolean;
}

export class FakeIssuer {
  private constructor(
    readonly options: FakeIssuerOptions,
    readonly kid: string,
    private readonly privateKey: CryptoKey,
    private readonly publicJwk: JWK,
    private readonly forgingKey: CryptoKey,
  ) {}

  static async create(options: FakeIssuerOptions): Promise<FakeIssuer> {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("the fake OIDC issuer must not run in production");
    }
    const kid = `fake-${Math.random().toString(36).slice(2, 10)}`;
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const forging = await generateKeyPair("RS256");
    const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
    return new FakeIssuer(options, kid, privateKey, publicJwk, forging.privateKey);
  }

  jwks(): { keys: JWK[] } {
    return { keys: [this.publicJwk] };
  }

  async mint(options: MintOptions): Promise<string> {
    if (!/^[^@\s]+@example\.org$/i.test(options.email)) {
      throw new Error("fake identities must use example.org addresses");
    }
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email: options.email, ...(options.name ? { name: options.name } : {}) })
      .setProtectedHeader({ alg: "RS256", kid: this.kid })
      .setSubject(options.sub)
      .setIssuer(options.issuer ?? this.options.issuer)
      .setAudience(options.audience ?? this.options.audience)
      .setIssuedAt(now - 1)
      .setExpirationTime(now + (options.expiresInSeconds ?? 3600))
      .sign(options.forge ? this.forgingKey : this.privateKey);
  }
}
