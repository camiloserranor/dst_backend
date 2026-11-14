# DST backend

TypeScript backend for the Design Support Team time & pay tracker. One service, two front doors:

- `/api/*` — REST API for the Angular app
- `/mcp` — MCP server so users can work with their data from Claude or ChatGPT

Both call the same `Services` class, which is where authorization and pay rules live.

## Layout

| Path | What |
|---|---|
| `src/config.ts` | Environment variables (validated at startup) |
| `src/auth/token.ts` | Access-token verification against the identity provider (issuer, audience, signature, expiry) |
| `src/db/schema.ts` | Table types for the existing MySQL DB — **inferred, verify against the real schema** |
| `src/db/mysqlRepo.ts` | All SQL (parameterized via Kysely) |
| `src/domain/pay.ts` | Pay calculation (REQUIREMENTS.md R-PAY-*) — always computed, never stored |
| `src/domain/rates.ts` | Rate history: which rate applies on a date; planning a rate change without back-dating |
| `src/domain/dates.ts` | Business dates in fixed UTC−5; which dates hours can be logged on |
| `src/services/services.ts` | Use cases + who may do what |
| `src/mcp/server.ts` | MCP tools (read-only), audit log |
| `src/http/app.ts` | Routes, token middleware, OAuth protected-resource metadata |
| `migrations/` | SQL to apply by hand to the existing DB |
| `test/` | Unit + end-to-end tests (in-memory data, real JWT and MCP protocol) |

## Commands

```bash
npm install
npm test
npm run typecheck
cp .env.example .env   # then fill it in
npm run dev
```

## How a request is authorized

1. The client sends `Authorization: Bearer <access token>` issued by the identity provider.
2. The token's signature, issuer, expiry and **audience** are checked. `/mcp` only accepts tokens for
   `PUBLIC_BASE_URL/mcp`; `/api` only accepts tokens for `API_AUDIENCE`.
3. The token's `sub` is looked up in `Empleado.idp_subject` (see `migrations/001_identity_link.sql`).
   No linked employee → 403.
4. The request runs as that employee; `Services` checks their access level (Consultant / Management /
   Accountability) for every operation, following REQUIREMENTS.md R-ACC-*.

Without a token, `/mcp` answers `401` with a `WWW-Authenticate` header pointing to
`/.well-known/oauth-protected-resource/mcp`, which tells Claude/ChatGPT where to send the user to log in.

## WorkOS setup (identity provider)

Decided 2026-11-13: WorkOS AuthKit (free up to 1M monthly active users).

1. Create a WorkOS account and an environment (start with **Staging**; use Production for go-live).
2. **Authentication**: keep Email + Password; turn on MFA if wanted. Sign-in is by **email**, so every
   employee needs an email address (REQUIREMENTS.md R-USR-3).
3. **Connect → Configuration**: enable **Client ID Metadata Document (CIMD)** and **Dynamic Client
   Registration (DCR)**, so both Claude and ChatGPT can register themselves.
4. **Resource Indicators**: add `PUBLIC_BASE_URL/mcp` (exactly, e.g. `https://api.designsupportteam.com/mcp`)
   and `PUBLIC_BASE_URL/api`. Tokens get `aud` = the resource the client asked for; this server rejects
   any other audience. Without Resource Indicators, WorkOS falls back to the client ID as `aud` and
   every request here will fail with 401.
5. Copy the **AuthKit domain** into `OIDC_ISSUER`.
6. Create each employee in WorkOS (or invite them), then link them:
   `UPDATE Empleado SET idp_subject = '<WorkOS user id, user_...>' WHERE codigo = ...;`
   (`migrations/001_identity_link.sql` adds that column).

Tokens with `sub_profile = "ai_agent"` (WorkOS agent tokens) are rejected: every call must come from a person.

## Not done yet

- WorkOS account not created; users not migrated (need emails).
- Real DB schema not verified; migration not applied.
- Write operations (log hours, edit entries, manage projects/users/rates).
- Rate limiting.
- CI/CD and Azure Container Apps deployment.
