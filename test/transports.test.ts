import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { mountMcp } from '../src/mcp/http.js';
import { fixture } from './helpers.js';

test('HTTP MCP authenticates, notifies live category changes, and rejects revoked sessions', async () => {
  const { store, manager } = await fixture();
  const { key, secret } = store.createKey({
    label: 'transport',
    bots: ['hello'],
    readOnly: false,
    categories: null,
  });
  const app = express();
  app.use(express.json());
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  const close = mountMcp(app, store, manager, url);
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${secret}` } },
  });
  try {
    assert.equal((await fetch(`${url}/mcp`)).status, 401);
    await client.connect(transport);
    assert.ok(
      (await client.listTools()).tools.some(
        (tool) => tool.name === 'messages_send',
      ),
    );
    const changed = new Promise<void>((resolve) =>
      client.setNotificationHandler(ToolListChangedNotificationSchema, () =>
        resolve(),
      ),
    );
    store.saveBot({ ...store.bots()[0], categories: [] });
    await Promise.race([
      changed,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('No tools/list_changed received')),
          2000,
        ).unref(),
      ),
    ]);
    assert.ok(
      !(await client.listTools()).tools.some(
        (tool) => tool.name === 'messages_send',
      ),
    );
    store.revokeKey(key.id);
    assert.equal(
      (
        await fetch(`${url}/mcp`, {
          headers: {
            Authorization: `Bearer ${secret}`,
            'mcp-session-id': transport.sessionId!,
          },
        })
      ).status,
      401,
    );
  } finally {
    await client.close();
    await close();
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    manager.close();
    store.close();
  }
});
