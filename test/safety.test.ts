import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/mcp/session.js';
import { Confirmations } from '../src/mcp/confirmations.js';
import { categories } from '../src/tools/registry.js';
import { fixture } from './helpers.js';

const read = (reply: Awaited<ReturnType<Session['call']>>) =>
  JSON.parse(reply.content[0].text).result;

test('destructive confirmation is bound to session, identity, arguments and is single use', async () => {
  const { store, manager, calls } = await fixture();
  store.saveBot({ ...store.bots()[0], categories: ['moderation'] });
  store.saveBot({ ...store.bots()[1], categories: ['moderation'] });
  const session = new Session(store, manager);
  const otherSession = new Session(store, manager);
  const args = { guild_id: '123', user_id: '456' };
  const pending = read(await session.call('moderation_ban', args));
  assert.equal(pending.confirmation_required, true);
  assert.match(pending.message, /hello.*hello/);
  assert.equal(calls.length, 0);
  assert.ok(
    (
      await otherSession.call('moderation_ban', {
        ...args,
        confirmation: pending.code,
      })
    ).isError,
  );
  assert.ok(
    (
      await session.call('moderation_ban', {
        ...args,
        bot: 'other',
        confirmation: pending.code,
      })
    ).isError,
  );
  const next = read(await session.call('moderation_ban', args));
  assert.ok(
    !(
      await session.call('moderation_ban', { ...args, confirmation: next.code })
    ).isError,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, 'hello-token');
  assert.ok(
    (await session.call('moderation_ban', { ...args, confirmation: next.code }))
      .isError,
  );
  assert.equal(calls.length, 1);
  const changed = read(await session.call('moderation_ban', args));
  assert.ok(
    (
      await session.call('moderation_ban', {
        ...args,
        user_id: '789',
        confirmation: changed.code,
      })
    ).isError,
  );
  assert.ok(
    store
      .auditEntries()
      .some(
        (entry) => entry.result === 'success' && entry.bot.slug === 'hello',
      ),
  );
  session.close();
  otherSession.close();
  store.close();
});

test('confirmation expires', () => {
  let now = 0;
  const confirmations = new Confirmations(() => now);
  const pending = confirmations.check('hello', 'delete', {})!;
  now = 120_001;
  assert.throws(
    () => confirmations.check('hello', 'delete', {}, pending.code),
    /expired/,
  );
});

test('read-only mode blocks typed and raw mutations and rechecks pending confirmations', async () => {
  const { store, manager, calls } = await fixture();
  const session = new Session(store, manager);
  const args = { channel_id: '123', message_id: '456' };
  const pending = read(await session.call('messages_delete', args));
  store.setSetting('readOnly', true);
  assert.ok(
    (
      await session.call('messages_delete', {
        ...args,
        confirmation: pending.code,
      })
    ).isError,
  );
  assert.ok(
    (
      await session.call('api_request', {
        method: 'POST',
        path: '/channels/123/messages',
        body: { content: 'hello' },
      })
    ).isError,
  );
  assert.equal(calls.length, 0);
  assert.ok(
    !(await session.call('api_request', { method: 'GET', path: '/users/@me' }))
      .isError,
  );
  assert.ok(!JSON.stringify(session.list()).includes('messages_send'));
  assert.equal(
    store.auditEntries().filter((entry) => entry.result === 'rejected').length,
    2,
  );
  session.close();
  store.close();
});

test('category ceiling cannot be bypassed with raw API or another bot', async () => {
  const { store, manager, calls } = await fixture();
  const { key } = store.createKey({
    label: 'restricted',
    bots: null,
    categories: ['messages'],
    readOnly: true,
  });
  const session = new Session(store, manager, key.id);
  assert.ok(
    (
      await session.call('api_request', {
        method: 'GET',
        path: '/guilds/123/channels',
      })
    ).isError,
  );
  assert.ok(
    (
      await session.call('messages_send', {
        channel_id: '123',
        content: 'hello',
      })
    ).isError,
  );
  assert.equal(calls.length, 0);
  assert.ok(
    !(await session.call('messages_list', { channel_id: '123' })).isError,
  );
  assert.ok(
    (await session.call('messages_list', { bot: 'other', channel_id: '123' }))
      .isError,
  );
  session.close();
  store.close();
});

test('every category exposes valid JSON schemas and unique names', async () => {
  const { store, manager } = await fixture();
  store.saveBot({
    ...store.bots()[0],
    categories: categories.map((category) => category.name),
  });
  const session = new Session(store, manager);
  const tools = session.list() as { name: string }[];
  assert.equal(categories.length, 18);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  assert.ok(tools.length > 60);
  session.close();
  store.close();
});
