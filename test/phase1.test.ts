import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SecretBox } from '../src/storage/secrets.js';
import { Session } from '../src/mcp/session.js';
import { fixture } from './helpers.js';

function result(reply: Awaited<ReturnType<Session['call']>>) {
  return JSON.parse(reply.content[0].text);
}

test('AES-GCM round trip, randomized ciphertext, authentication and wrong master secret', () => {
  const box = new SecretBox('a'.repeat(32));
  const encrypted = box.encrypt('secret-token');
  assert.equal(box.decrypt(encrypted), 'secret-token');
  assert.notEqual(encrypted, box.encrypt('secret-token'));
  assert.ok(!encrypted.includes('secret-token'));
  assert.throws(() => new SecretBox('b'.repeat(32)).decrypt(encrypted));
  const parts = encrypted.split('.');
  parts[1] = Buffer.alloc(16).toString('base64url');
  assert.throws(() => box.decrypt(parts.join('.')));
});

test('key scope hides identity from enumeration, switches, overrides and raw API', async () => {
  const { store, manager, calls } = await fixture();
  const { key, secret } = store.createKey({
    label: 'hello only',
    bots: ['hello'],
    readOnly: false,
    categories: null,
  });
  assert.ok(!JSON.stringify(store.keys()).includes(secret));
  assert.equal(store.authenticate(secret)?.id, key.id);
  const session = new Session(store, manager, key.id);
  const listed = result(await session.call('list_bots', {}));
  assert.deepEqual(
    listed.result.map((bot: { slug: string }) => bot.slug),
    ['hello'],
  );
  for (const slug of ['other', 'nonexistent']) {
    assert.equal(
      result(await session.call('whoami', { bot: slug })).result.error,
      'Bot not found.',
    );
    assert.equal(
      result(await session.call('set_active_bot', { slug })).result.error,
      'Bot not found.',
    );
    assert.equal(
      result(
        await session.call('api_request', {
          bot: slug,
          method: 'GET',
          path: '/users/@me',
        }),
      ).result.error,
      'Bot not found.',
    );
  }
  assert.equal(calls.length, 0);
  assert.equal(result(await session.call('whoami', {})).bot.slug, 'hello');
  session.close();
  store.close();
});

test('sessions resolve default independently, overrides do not persist, category changes notify', async () => {
  const { store, manager } = await fixture();
  let notifications = 0;
  const first = new Session(store, manager, undefined, () => notifications++);
  const second = new Session(store, manager);
  assert.equal(first.resolve().slug, 'hello');
  first.setActive('other');
  assert.equal(first.resolve().slug, 'other');
  assert.equal(second.resolve().slug, 'hello');
  assert.equal(
    result(await first.call('whoami', { bot: 'hello' })).bot.slug,
    'hello',
  );
  assert.equal(first.resolve().slug, 'other');
  assert.ok(!JSON.stringify(first.list()).includes('messages_send'));
  store.saveBot({ ...first.resolve(), categories: ['messages'] });
  assert.equal(notifications, 2);
  assert.ok(JSON.stringify(first.list()).includes('messages_send'));
  first.close();
  second.close();
  store.close();
});

test('key revocation disconnects immediately; bot removal leaves a scoped key inert', async () => {
  const { store, manager } = await fixture();
  const { key } = store.createKey({
    label: 'test',
    bots: ['hello'],
    readOnly: false,
    categories: [],
  });
  let disconnected = false;
  const session = new Session(store, manager, key.id, undefined, () => {
    disconnected = true;
  });
  assert.ok(!JSON.stringify(session.list()).includes('messages_list'));
  manager.remove('hello');
  assert.deepEqual(session.bots(), []);
  assert.deepEqual(session.list(), []);
  store.revokeKey(key.id);
  assert.ok(disconnected);
  assert.throws(() => session.resolve());
  store.close();
});

test('invalid tokens are not saved; offline login is contained', async () => {
  const { store, manager } = await fixture();
  await assert.rejects(
    manager.save('invalid', 'invalid', []),
    /validation failed/,
  );
  assert.ok(!store.bots().some((bot) => bot.slug === 'invalid'));
  await manager.save('offline', 'offline-token', []);
  assert.match(manager.status('offline').error!, /offline/);
  manager.close();
  store.close();
});
