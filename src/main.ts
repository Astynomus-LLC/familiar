#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Store } from './storage/store.js';
import { SecretBox } from './storage/secrets.js';
import { BotManager } from './bots/manager.js';
import { mountMcp } from './mcp/http.js';
import { createMcpServer } from './mcp/server.js';
import { mountAdmin } from './web/admin.js';

const port = Number(process.env.PORT ?? 3000);
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be between 1 and 65535.');
const canonical = new URL(publicUrl);
if (
  !['http:', 'https:'].includes(canonical.protocol) ||
  canonical.pathname !== '/' ||
  canonical.search ||
  canonical.hash ||
  canonical.username ||
  canonical.password
)
  throw new Error(
    'PUBLIC_URL must be an HTTP(S) origin with no path or credentials.',
  );
const secrets = new SecretBox(process.env.MASTER_SECRET ?? '');
const data = resolve('data');
mkdirSync(data, { recursive: true, mode: 0o700 });
const store = new Store(resolve(data, 'familiar.sqlite'));
const manager = new BotManager(store, secrets);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
const closeHttp = mountMcp(app, store, manager, publicUrl);
mountAdmin(app, store, manager, { store, secrets, publicUrl });
const listener = app.listen(port, () =>
  console.error(`Familiar admin: ${publicUrl}`),
);
const mcp = process.argv.includes('--stdio')
  ? createMcpServer(store, manager)
  : undefined;
if (mcp) await mcp.server.connect(new StdioServerTransport());
void manager.start();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await closeHttp();
  await mcp?.server.close();
  manager.close();
  listener.close();
  store.close();
}
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});

if (mcp)
  process.stdin.once('end', () => {
    void stop();
  });
