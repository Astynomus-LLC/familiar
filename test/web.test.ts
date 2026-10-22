import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { mountAdmin } from '../src/web/admin.js';
import { fixture } from './helpers.js';

export async function webFixture(recover = false) {
  const context = await fixture();
  for (const bot of context.store.bots()) context.manager.remove(bot.slug);
  if (recover) {
    context.store.savePerson({
      id: '100',
      name: 'Original owner',
      avatar: null,
      role: 'owner',
    });
    context.store.setSetting('oauthClientId', '123');
    context.store.setSetting('oauthClientSecret', 'unreadable ciphertext');
  }
  const app = express();
  app.use(express.json());
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  let setupCode = '';
  let identity = {
    id: '100',
    username: 'Owner',
    avatar: null as string | null,
  };
  mountAdmin(app, context.store, context.manager, {
    ...context,
    publicUrl: origin,
    printSetupCode: (code) => {
      setupCode = code;
    },
    oauth: {
      async exchange() {
        return identity;
      },
    },
  });
  const browser = () => {
    let cookie = '';
    return async (
      path: string,
      method = 'GET',
      body?: unknown,
      requestOrigin = origin,
    ) => {
      const response = await fetch(`${origin}${path}`, {
        method,
        redirect: 'manual',
        headers: {
          Cookie: cookie,
          Origin: requestOrigin,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie')!.split(';')[0];
      return response;
    };
  };
  return {
    ...context,
    origin,
    setupCode,
    browser,
    setIdentity: (id: string, username: string) => {
      identity = { id, username, avatar: null };
    },
    async close() {
      listener.closeAllConnections();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      context.manager.close();
      context.store.close();
    },
  };
}

async function login(
  browser: ReturnType<Awaited<ReturnType<typeof webFixture>>['browser']>,
) {
  const start = await browser('/auth/login');
  const state = new URL(start.headers.get('location')!).searchParams.get(
    'state',
  );
  return browser(`/auth/callback?code=test&state=${state}`);
}

test('fresh setup claims owner, configures bot, generates one-time scoped key, and preserves secrets', async () => {
  const fixture = await webFixture();
  const browser = fixture.browser();
  try {
    assert.equal((await browser('/')).status, 200);
    assert.equal((await browser('/api/admin/state')).status, 403);
    assert.equal(
      (
        await browser(
          '/api/setup/verify',
          'POST',
          { code: fixture.setupCode },
          'https://evil.example',
        )
      ).status,
      403,
    );
    assert.equal(
      (await browser('/api/setup/verify', 'POST', { code: 'wrong' })).status,
      403,
    );
    assert.equal(
      (await browser('/api/setup/verify', 'POST', { code: fixture.setupCode }))
        .status,
      200,
    );
    assert.equal(
      (
        await fixture.browser()('/api/setup/verify', 'POST', {
          code: fixture.setupCode,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await browser('/api/setup/oauth', 'POST', {
          clientId: '123',
          clientSecret: 'oauth-secret',
        })
      ).status,
      200,
    );
    assert.notEqual(fixture.store.setting('oauthClientSecret'), 'oauth-secret');
    assert.equal((await login(browser)).status, 302);
    assert.equal(fixture.store.people()[0].role, 'owner');
    assert.equal(
      (await browser('/api/setup/verify', 'POST', { code: fixture.setupCode }))
        .status,
      404,
    );
    assert.equal(
      (
        await browser('/api/admin/bots', 'POST', {
          slug: 'hello',
          token: 'hello-token',
          categories: ['messages'],
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await browser('/api/admin/bots/hello', 'PATCH', {
          categories: ['messages', 'moderation'],
        })
      ).status,
      200,
    );
    const created = await (
      await browser('/api/admin/keys', 'POST', {
        label: 'agent',
        bots: ['hello'],
        readOnly: true,
        categories: ['messages'],
      })
    ).json();
    assert.ok(created.secret.startsWith('fam_'));
    assert.equal(
      created.config.mcpServers.familiar.url,
      `${fixture.origin}/mcp`,
    );
    assert.equal(fixture.store.authenticate(created.secret)?.label, 'agent');
    const stateText = await (await browser('/api/admin/state')).text();
    assert.ok(!stateText.includes('hello-token'));
    assert.ok(!stateText.includes(created.secret));
    assert.ok(!stateText.includes(fixture.store.keys()[0].hash));
    const affected = await (
      await browser('/api/admin/bots/hello/affected-keys')
    ).json();
    assert.equal(affected[0].becomesInert, true);
  } finally {
    await fixture.close();
  }
});

test('OAuth state is single use, approval gates access, members cannot administer ownership or access', async () => {
  const fixture = await webFixture();
  const owner = fixture.browser();
  try {
    await owner('/api/setup/verify', 'POST', { code: fixture.setupCode });
    await owner('/api/setup/oauth', 'POST', {
      clientId: '123',
      clientSecret: 'secret',
    });
    await login(owner);
    fixture.setIdentity('200', 'Member');
    const member = fixture.browser();
    const start = await member('/auth/login');
    const state = new URL(start.headers.get('location')!).searchParams.get(
      'state',
    );
    assert.equal(
      (await fixture.browser()(`/auth/callback?code=test&state=${state}`))
        .status,
      400,
    );
    assert.equal(
      (await member(`/auth/callback?code=test&state=${state}`)).status,
      302,
    );
    assert.equal(
      (await member(`/auth/callback?code=test&state=${state}`)).status,
      400,
    );
    assert.equal((await member('/api/admin/state')).status, 403);
    assert.equal(
      (await owner('/api/admin/access', 'POST', { id: '200', role: 'member' }))
        .status,
      200,
    );
    assert.equal((await member('/api/admin/state')).status, 200);
    assert.equal((await member('/api/admin/access')).status, 403);
    assert.equal(
      (
        await member('/api/admin/ownership', 'POST', {
          id: '200',
          confirm: 'transfer ownership',
        })
      ).status,
      403,
    );
    assert.equal(
      (await owner('/api/admin/access', 'POST', { id: '200', role: 'denied' }))
        .status,
      200,
    );
    assert.equal((await member('/api/admin/state')).status, 403);
  } finally {
    await fixture.close();
  }
});

test('lost-master OAuth recovery preserves ownership and does not admit a new owner', async () => {
  const fixture = await webFixture(true);
  const browser = fixture.browser();
  try {
    assert.equal(
      (await (await browser('/api/session')).json()).setupRequired,
      true,
    );
    assert.equal(
      (await browser('/api/setup/verify', 'POST', { code: fixture.setupCode }))
        .status,
      200,
    );
    assert.equal(
      (
        await browser('/api/setup/oauth', 'POST', {
          clientId: '123',
          clientSecret: 'replacement',
        })
      ).status,
      200,
    );
    fixture.setIdentity('200', 'New user');
    await login(browser);
    assert.equal(
      fixture.store.people().find((person) => person.id === '100')?.role,
      'owner',
    );
    assert.equal(
      fixture.store.people().find((person) => person.id === '200')?.role,
      'pending',
    );
    assert.equal((await browser('/api/admin/state')).status, 403);
    fixture.setIdentity('100', 'Original owner');
    const owner = fixture.browser();
    await login(owner);
    assert.equal((await owner('/api/admin/state')).status, 200);
    await owner('/api/admin/access', 'POST', { id: '200', role: 'member' });
    assert.equal(
      (
        await owner('/api/admin/ownership', 'POST', {
          id: '200',
          confirm: 'transfer ownership',
        })
      ).status,
      200,
    );
    assert.equal((await owner('/api/admin/access')).status, 403);
    assert.equal((await browser('/api/admin/access')).status, 200);
  } finally {
    await fixture.close();
  }
});

test('feature admin endpoints share MCP config and expose degraded instances', async () => {
  const f = await webFixture();
  const browser = f.browser();
  try {
    await browser('/api/setup/verify', 'POST', { code: f.setupCode });
    await browser('/api/setup/oauth', 'POST', {
      clientId: '123',
      clientSecret: 'secret',
    });
    await login(browser);
    await f.manager.save('hello', 'hello-token', ['features']);
    const { Session } = await import('../src/mcp/session.js');
    const session = new Session(f.store, f.manager);
    const enabled = await session.call('set_feature_enabled', {
      guild: '10',
      feature_id: 'logging',
      enabled: true,
      config: { channelId: '99' },
    });
    assert.equal(enabled.isError, undefined);
    await session.call('configure_feature', {
      guild: '10',
      feature_id: 'logging',
      config: { channelId: '98' },
    });
    const guilds = await (
      await browser('/api/admin/bots/hello/servers')
    ).json();
    assert.equal(guilds[0].features[0].config.channelId, '98');
    assert.equal(guilds[0].features[0].state, 'degraded');
    const state = await (await browser('/api/admin/state')).json();
    assert.ok(
      state.bots[0].degraded[0].missingIntents.includes('GuildMembers'),
    );
    assert.equal(
      (
        await browser('/api/admin/bots/hello/features', 'PATCH', {
          guild: '10',
          featureId: 'logging',
          enabled: false,
        })
      ).status,
      200,
    );
    const status = await session.call('list_features', { guild: '10' });
    assert.equal(
      JSON.parse(status.content[0].text).result[0].features[0].enabled,
      false,
    );
    session.close();
  } finally {
    await f.close();
  }
});
