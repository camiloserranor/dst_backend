import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  /** Public URL of this service, without trailing slash, e.g. https://api.designsupportteam.com */
  PUBLIC_BASE_URL: z.url().transform((u) => u.replace(/\/+$/, '')),
  /** Issuer of the identity provider (OIDC), e.g. https://auth.designsupportteam.com */
  OIDC_ISSUER: z.url(),
  /** Optional: JWKS URL. If omitted it is discovered from the issuer's openid-configuration. */
  OIDC_JWKS_URI: z.url().optional(),
  /** Audience the web app's access tokens are issued for. Defaults to PUBLIC_BASE_URL/api. */
  API_AUDIENCE: z.string().optional(),
  /** Comma-separated browser origins allowed to call /api (the Angular app). */
  CORS_ORIGINS: z.string().default(''),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().default('general'),
  /** Require TLS to MySQL. Only turn off for a local dev database. */
  DB_SSL: bool.default(true),
});

export interface Config {
  port: number;
  publicBaseUrl: string;
  /** RFC 8707 resource identifier of the MCP endpoint; also the required token audience on /mcp. */
  mcpResource: string;
  apiAudience: string;
  oidcIssuer: string;
  oidcJwksUri: string | undefined;
  corsOrigins: string[];
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl: boolean;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  return {
    port: e.PORT,
    publicBaseUrl: e.PUBLIC_BASE_URL,
    mcpResource: `${e.PUBLIC_BASE_URL}/mcp`,
    apiAudience: e.API_AUDIENCE ?? `${e.PUBLIC_BASE_URL}/api`,
    oidcIssuer: e.OIDC_ISSUER,
    oidcJwksUri: e.OIDC_JWKS_URI,
    corsOrigins: e.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    db: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      user: e.DB_USER,
      password: e.DB_PASSWORD,
      database: e.DB_NAME,
      ssl: e.DB_SSL,
    },
  };
}
