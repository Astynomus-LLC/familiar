import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Store } from '../storage/store.js';
import type { BotManager } from '../bots/manager.js';
import { createMcpServer } from './server.js';

export function mountMcp(
  app: Express,
  store: Store,
  manager: BotManager,
  publicUrl: string,
): () => Promise<void> {
  const sessions = new Map<
    string,
    {
      keyId: string;
      transport: StreamableHTTPServerTransport;
      close: () => Promise<void>;
      lastUsed: number;
    }
  >();
  const timer = setInterval(() => {
    for (const session of sessions.values())
      if (Date.now() - session.lastUsed > 30 * 60_000) void session.close();
  }, 60_000).unref();

  app.all('/mcp', async (req, res) => {
    if (
      req.headers.origin &&
      req.headers.origin !== new URL(publicUrl).origin
    ) {
      res.status(403).end();
      return;
    }
    const secret = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const key = secret ? store.authenticate(secret) : undefined;
    if (!key) {
      res.status(401).json({ error: 'Invalid API key.' });
      return;
    }
    const id = req.headers['mcp-session-id'];
    if (typeof id === 'string') {
      const session = sessions.get(id);
      if (!session || session.keyId !== key.id) {
        res.status(404).json({ error: 'Session not found.' });
        return;
      }
      session.lastUsed = Date.now();
      await session.transport.handleRequest(req, res, req.body);
      return;
    }
    if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
      res.status(400).json({ error: 'Initialize a session first.' });
      return;
    }
    if (sessions.size >= 200) {
      res.status(503).json({ error: 'Session limit reached.' });
      return;
    }
    const { server, session } = createMcpServer(store, manager, key.id);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, {
          keyId: key.id,
          transport,
          close: () => server.close(),
          lastUsed: Date.now(),
        });
      },
    });
    server.onclose = () => {
      session.close();
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  return async () => {
    clearInterval(timer);
    await Promise.all([...sessions.values()].map((session) => session.close()));
  };
}
