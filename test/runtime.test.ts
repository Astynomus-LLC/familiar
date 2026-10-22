import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { REST } from 'discord.js';
import { discordConnection } from '../src/bots/manager.js';
import { Store } from '../src/storage/store.js';
import { SecretBox } from '../src/storage/secrets.js';

test('stdio executable serves MCP and UI from a fresh persistent directory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'familiar-stdio-'));
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('dist/main.js'), '--stdio'],
    cwd: directory,
    env: {
      MASTER_SECRET: 'stdio test master secret is sufficiently long',
      PORT: String(port),
    },
    stderr: 'pipe',
  });
  let logs = '';
  transport.stderr?.on('data', (chunk) => {
    logs += String(chunk);
  });
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(transport);
    assert.ok(
      (await client.listTools()).tools.some(
        (tool) => tool.name === 'list_bots',
      ),
    );
    const reply = await client.callTool({ name: 'list_bots', arguments: {} });
    assert.ok(!reply.isError);
    assert.equal((await fetch(`http://localhost:${port}/health`)).status, 200);
    assert.equal(
      (await (await fetch(`http://localhost:${port}/api/session`)).json())
        .setupRequired,
      true,
    );
    assert.match(logs, /Familiar setup code:/);
  } finally {
    await client.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite survives reopen with encrypted bot tokens and verify-only keys', () => {
  const directory = mkdtempSync(join(tmpdir(), 'familiar-storage-'));
  const path = join(directory, 'config.sqlite');
  const secrets = new SecretBox('persistent test master secret length');
  let store = new Store(path);
  try {
    store.saveBot({
      slug: 'hello',
      id: '1',
      name: 'Hello',
      avatar: null,
      token: secrets.encrypt('bot-token'),
      categories: ['messages'],
    });
    const { secret } = store.createKey({
      label: 'agent',
      bots: ['hello'],
      readOnly: false,
      categories: null,
    });
    store.close();
    store = new Store(path);
    assert.equal(secrets.decrypt(store.bots()[0].token), 'bot-token');
    assert.equal(store.authenticate(secret)?.label, 'agent');
    store.deleteBot('hello');
    assert.deepEqual(store.authenticate(secret)?.bots, []);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('REST adapter preserves queries and constructs named multipart form fields', async () => {
  const request = mock.method(
    REST.prototype,
    'request',
    async (options: unknown) => options,
  );
  const connection = discordConnection('mock-token');
  try {
    const reply = (await connection.request(
      'POST',
      '/guilds/123/stickers?reason=test',
      { name: 'sticker', tags: 'smile' },
      [
        {
          name: 'sticker.png',
          key: 'file',
          data: 'aGVsbG8=',
          contentType: 'image/png',
        },
      ],
      true,
    )) as {
      fullRoute: string;
      query: URLSearchParams;
      files: { key: string; data: Buffer }[];
      appendToFormData: boolean;
    };
    assert.equal(reply.fullRoute, '/guilds/123/stickers');
    assert.equal(reply.query.get('reason'), 'test');
    assert.equal(reply.files[0].key, 'file');
    assert.equal(reply.files[0].data.toString(), 'hello');
    assert.equal(reply.appendToFormData, true);
  } finally {
    connection.destroy();
    request.mock.restore();
  }
});

test('stdio exits when the client closes stdin, including when launched through a wrapper', async () => {
  const { spawn } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'familiar-eof-'));
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const child = spawn(process.execPath, [resolve('dist/main.js'), '--stdio'], {
    cwd: directory,
    env: {
      MASTER_SECRET: 'stdio EOF test master secret sufficiently long',
      PORT: String(port),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    const exited = once(child, 'exit');
    child.stdin.end();
    const result = await Promise.race([
      exited,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Stdio process did not exit on EOF')),
          5000,
        ).unref(),
      ),
    ]);
    assert.deepEqual(result, [0, null]);
  } finally {
    child.kill();
    rmSync(directory, { recursive: true, force: true });
  }
});
