/**
 * End-to-end over HTTP: real JWT signing/verification (with a local test key), real MCP protocol,
 * in-memory data. Proves that the token decides who you are and what you can see.
 */
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createJwtVerifier } from '../src/auth/token.js';
import { createApp } from '../src/http/app.js';
import { Services } from '../src/services/services.js';
import { memoryRepo, sampleFixture } from './memoryRepo.js';

const BASE = 'https://api.example.test';
const ISSUER = 'https://auth.example.test/';
const MCP = `${BASE}/mcp`;

let sign: (sub: string, opts?: { aud?: string; iss?: string; exp?: string; extra?: Record<string, unknown> }) => Promise<string>;
let app: ReturnType<typeof createApp>;
const audit: unknown[] = [];

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  sign = (sub, o = {}) =>
    new SignJWT({ scope: 'openid profile', azp: 'claude', ...o.extra })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject(sub)
      .setIssuer(o.iss ?? ISSUER)
      .setAudience(o.aud ?? MCP)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? '5m')
      .sign(privateKey);

  const repo = memoryRepo(sampleFixture());
  app = createApp({
    publicBaseUrl: BASE,
    mcpResource: MCP,
    apiAudience: `${BASE}/api`,
    oidcIssuer: ISSUER,
    corsOrigins: ['https://app.example.test'],
    verifyToken: createJwtVerifier({ issuer: ISSUER, keys: createLocalJWKSet({ keys: [jwk] }) }),
    repo,
    services: new Services(repo),
    audit: (e) => audit.push(e),
  });
});

let rpcId = 1;
async function mcp(token: string | undefined, method: string, params: object = {}) {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  return res;
}

async function callTool(token: string, name: string, args: object = {}) {
  const res = await mcp(token, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { isError?: boolean; content: { text: string }[] } };
  return body.result;
}

describe('MCP auth discovery', () => {
  it('publishes protected resource metadata', async () => {
    const res = await app.request('/.well-known/oauth-protected-resource/mcp');
    expect(await res.json()).toMatchObject({ resource: MCP, authorization_servers: [ISSUER] });
  });

  it('answers 401 with a WWW-Authenticate pointer when no token is sent', async () => {
    const res = await mcp(undefined, 'tools/list');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
  });

  it('rejects tokens for another audience or issuer, expired tokens, and agent tokens', async () => {
    for (const t of [
      await sign('sub-owner', { aud: 'https://other-service.test' }),
      await sign('sub-owner', { aud: `${BASE}/api` }),
      await sign('sub-owner', { iss: 'https://evil.test/' }),
      await sign('sub-owner', { exp: '-1m' }),
      await sign('sub-owner', { extra: { sub_profile: 'ai_agent' } }), // WorkOS agent token
    ]) {
      expect((await mcp(t, 'tools/list')).status).toBe(401);
    }
  });

  it('rejects valid logins that are not linked to a DST employee', async () => {
    expect((await mcp(await sign('sub-stranger'), 'tools/list')).status).toBe(403);
  });
});

describe('MCP tools', () => {
  it('initializes and lists read-only tools', async () => {
    const init = await mcp(await sign('sub-emma'), 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.status).toBe(200);

    const res = await mcp(await sign('sub-emma'), 'tools/list');
    const { result } = (await res.json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(result.tools.map((t) => t.name)).toContain('get_monthly_payroll');
    expect(result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it('runs tools as the token\'s user', async () => {
    const r = await callTool(await sign('sub-emma'), 'whoami');
    expect(JSON.parse(r.content[0]!.text)).toMatchObject({ employeeId: 3, role: 'consultant' });
  });

  it('an employee cannot read payroll or another employee\'s hours', async () => {
    const t = await sign('sub-emma');
    expect(await callTool(t, 'get_monthly_payroll', { month: '2026-10' })).toMatchObject({ isError: true });
    expect(await callTool(t, 'get_employee_hours', { employeeId: 4, from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ isError: true });
    expect(audit).toContainEqual(expect.objectContaining({ employeeId: 3, tool: 'get_monthly_payroll', outcome: 'denied' }));
  });

  it('the owner gets the payroll', async () => {
    const r = await callTool(await sign('sub-owner'), 'get_monthly_payroll', { month: '2026-10' });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0]!.text).grandTotal).toBe(8 * 30 + 4 * 32 + 5 * 50);
  });

  it('validates tool input', async () => {
    const r = await callTool(await sign('sub-owner'), 'get_monthly_payroll', { month: 'October' });
    expect(r.isError).toBe(true);
  });
});

describe('REST API', () => {
  it('requires a token issued for the API audience', async () => {
    expect((await app.request('/api/me')).status).toBe(401);
    const mcpToken = await sign('sub-emma');
    expect((await app.request('/api/me', { headers: { authorization: `Bearer ${mcpToken}` } })).status).toBe(401);
    const apiToken = await sign('sub-emma', { aud: `${BASE}/api` });
    const res = await app.request('/api/me', { headers: { authorization: `Bearer ${apiToken}` } });
    expect(res.status).toBe(200);
  });

  it('maps authorization errors to 403', async () => {
    const t = await sign('sub-emma', { aud: `${BASE}/api` });
    expect((await app.request('/api/payroll?month=2026-10', { headers: { authorization: `Bearer ${t}` } })).status).toBe(403);
  });
});
