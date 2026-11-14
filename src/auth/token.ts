import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface VerifiedToken {
  token: string;
  subject: string;
  clientId: string;
  scopes: string[];
  expiresAt: number | undefined;
}

/** Verifies an access token for the given audience. Throws if invalid. */
export type TokenVerifier = (token: string, audience: string) => Promise<VerifiedToken>;

export function createJwtVerifier(opts: { issuer: string; keys: JWTVerifyGetKey }): TokenVerifier {
  return async (token, audience) => {
    const { payload } = await jwtVerify(token, opts.keys, {
      issuer: opts.issuer,
      audience, // RFC 8707: reject tokens minted for any other resource
      algorithms: ['RS256', 'PS256', 'ES256', 'EdDSA'],
      requiredClaims: ['sub', 'exp'],
      clockTolerance: 30,
    });
    // WorkOS signs "agent tokens" (machine identities) with the same issuer; this server only
    // accepts tokens that represent a signed-in person.
    if (payload.sub_profile === 'ai_agent') throw new Error('Agent tokens are not accepted');

    const scope = payload.scope ?? payload.scp;
    const scopes = Array.isArray(scope) ? scope.map(String) : typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [];
    return {
      token,
      subject: payload.sub!,
      clientId: String(payload.azp ?? payload.client_id ?? ''),
      scopes,
      expiresAt: payload.exp,
    };
  };
}

/**
 * Build a verifier that fetches the identity provider's signing keys (cached by jose).
 * The JWKS URL is discovered from the issuer's metadata: OpenID Connect discovery first,
 * then OAuth authorization-server metadata (RFC 8414), which is what WorkOS AuthKit serves.
 */
export async function createOidcVerifier(issuer: string, jwksUri?: string): Promise<TokenVerifier> {
  let uri = jwksUri;
  if (!uri) {
    const base = issuer.endsWith('/') ? issuer : `${issuer}/`;
    const tried: string[] = [];
    for (const path of ['.well-known/openid-configuration', '.well-known/oauth-authorization-server']) {
      const res = await fetch(new URL(path, base));
      tried.push(`${path}: HTTP ${res.status}`);
      if (!res.ok) continue;
      const doc = (await res.json()) as { jwks_uri?: string };
      if (doc.jwks_uri) {
        uri = doc.jwks_uri;
        break;
      }
    }
    if (!uri) throw new Error(`Could not discover jwks_uri for ${issuer} (${tried.join('; ')}). Set OIDC_JWKS_URI.`);
  }
  return createJwtVerifier({ issuer, keys: createRemoteJWKSet(new URL(uri)) });
}
