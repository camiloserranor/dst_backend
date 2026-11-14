import { serve } from '@hono/node-server';
import { createOidcVerifier } from './auth/token.js';
import { loadConfig } from './config.js';
import { createDb, createMysqlRepo } from './db/mysqlRepo.js';
import { createApp } from './http/app.js';
import { Services } from './services/services.js';

const config = loadConfig();
const db = createDb(config.db);
const repo = createMysqlRepo(db);

const app = createApp({
  ...config,
  verifyToken: await createOidcVerifier(config.oidcIssuer, config.oidcJwksUri),
  repo,
  services: new Services(repo),
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`DST backend listening on :${info.port} (MCP resource ${config.mcpResource})`);
});

const shutdown = async () => {
  server.close();
  await db.destroy();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
