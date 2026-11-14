import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import type { TokenVerifier, VerifiedToken } from '../auth/token.js';
import type { Repo } from '../db/repo.js';
import { BadRequestError, ForbiddenError, NotFoundError, type Principal } from '../domain/types.js';
import { buildMcpServer, consoleAudit, type AuditLog } from '../mcp/server.js';
import type { Services } from '../services/services.js';

export interface AppDeps {
  publicBaseUrl: string;
  mcpResource: string;
  apiAudience: string;
  oidcIssuer: string;
  corsOrigins: string[];
  verifyToken: TokenVerifier;
  repo: Repo;
  services: Services;
  audit?: AuditLog;
}

type Env = { Variables: { principal: Principal; token: VerifiedToken } };

export const SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();
  const metadataUrl = `${deps.publicBaseUrl}/.well-known/oauth-protected-resource/mcp`;

  app.use('*', secureHeaders());
  app.use('*', bodyLimit({ maxSize: 256 * 1024 }));

  app.get('/healthz', (c) => c.json({ ok: true }));

  // RFC 9728 Protected Resource Metadata: tells MCP clients which authorization server to use.
  const resourceMetadata = (c: Context) =>
    c.json({
      resource: deps.mcpResource,
      authorization_servers: [deps.oidcIssuer],
      bearer_methods_supported: ['header'],
      scopes_supported: SCOPES,
      resource_name: 'Design Support Team – time & pay tracker',
    });
  app.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata);
  app.get('/.well-known/oauth-protected-resource', resourceMetadata);

  /** Verifies the bearer token for `audience` and resolves it to a DST employee. */
  const requireUser =
    (audience: string, challenge: boolean): MiddlewareHandler<Env> =>
    async (c, next) => {
      const unauthorized = (error: string, description: string) => {
        if (challenge) {
          c.header(
            'WWW-Authenticate',
            `Bearer error="${error}", error_description="${description}", resource_metadata="${metadataUrl}"`,
          );
        }
        return c.json({ error, error_description: description }, 401);
      };

      const header = c.req.header('authorization') ?? '';
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      if (!match) return unauthorized('invalid_request', 'Missing bearer token');

      let token: VerifiedToken;
      try {
        token = await deps.verifyToken(match[1]!, audience);
      } catch {
        return unauthorized('invalid_token', 'Token is invalid, expired, or not issued for this resource');
      }

      const employee = await deps.repo.findEmployeeBySubject(token.subject);
      if (!employee) {
        return c.json({ error: 'forbidden', error_description: 'No Design Support Team account is linked to this login.' }, 403);
      }
      c.set('token', token);
      c.set('principal', { employeeId: employee.id, name: employee.name, username: employee.username, role: employee.role });
      await next();
    };

  // ---------- MCP (Streamable HTTP, stateless) ----------
  app.use(
    '/mcp',
    cors({
      // MCP clients like Claude/ChatGPT call server-to-server; CORS only matters for browser-based tools.
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'Last-Event-ID'],
      exposeHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
    }),
  );
  app.all('/mcp', requireUser(deps.mcpResource, true), async (c) => {
    const token = c.get('token');
    const server = buildMcpServer(deps.services, c.get('principal'), deps.audit ?? consoleAudit);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: each request stands alone, so it scales to zero
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw, {
        authInfo: {
          token: token.token,
          clientId: token.clientId,
          scopes: token.scopes,
          expiresAt: token.expiresAt,
          extra: { employeeId: c.get('principal').employeeId },
        },
      });
    } finally {
      await server.close();
    }
  });

  // ---------- REST API for the Angular app ----------
  const api = new Hono<Env>();
  api.use('*', requireUser(deps.apiAudience, false));

  const s = deps.services;
  const q = (c: Context<Env>, name: string) => {
    const v = c.req.query(name);
    if (!v) throw new BadRequestError(`Missing query parameter "${name}"`);
    return v;
  };
  const id = (v: string | undefined, name: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new BadRequestError(`Invalid ${name}`);
    return n;
  };

  api.get('/me', async (c) => c.json(await s.whoami(c.get('principal'))));
  api.get('/hours', async (c) => {
    const p = c.get('principal');
    const employeeId = c.req.query('employeeId') ? id(c.req.query('employeeId'), 'employeeId') : p.employeeId;
    return c.json(await s.employeeHours(p, employeeId, q(c, 'from'), q(c, 'to')));
  });
  api.get('/employees', async (c) => c.json(await s.listEmployees(c.get('principal'))));
  api.get('/projects', async (c) => c.json(await s.listProjects(c.get('principal'))));
  api.get('/projects/:id/hours', async (c) =>
    c.json(await s.projectHours(c.get('principal'), id(c.req.param('id'), 'project id'), q(c, 'from'), q(c, 'to'))),
  );
  api.get('/pay/me', async (c) => c.json(await s.myPay(c.get('principal'), q(c, 'month'))));
  api.get('/payroll', async (c) => c.json(await s.monthlyPayroll(c.get('principal'), q(c, 'month'))));

  app.use('/api/*', cors({ origin: deps.corsOrigins, allowHeaders: ['Authorization', 'Content-Type'], maxAge: 600 }));
  app.route('/api', api);

  app.onError((err, c) => {
    if (err instanceof BadRequestError) return c.json({ error: err.message }, 400);
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403);
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    console.error(err);
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
