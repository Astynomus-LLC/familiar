import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Client, GatewayIntentBits } from 'discord.js';
import { Store } from '../src/storage/store.js';
import { SecretBox } from '../src/storage/secrets.js';
import { BotManager, discordConnection } from '../src/bots/manager.js';
import { FeatureEngine } from '../src/features/engine.js';
import { features } from '../src/features/registry.js';
import { gatewaySettings } from '../src/features/types.js';
import { Session } from '../src/mcp/session.js';

async function setup(
  intents = gatewaySettings.parse({
    intents: [
      'Guilds',
      'GuildMessages',
      'GuildMembers',
      'GuildModeration',
      'MessageContent',
    ],
  }).intents,
) {
  const store = new Store(':memory:');
  const client = Object.assign(new EventEmitter(), {
    user: { id: '1' },
    isReady: () => false,
  });
  const sent: unknown[] = [];
  const assigned: unknown[] = [];
  const guilds = ['10', '20'].map((id) => ({
    id,
    name: 'Server',
    memberCount: 3,
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (body: unknown) => {
          sent.push({ id, body });
        },
      }),
    },
  }));
  const settings: unknown[] = [];
  const manager = new BotManager(
    store,
    new SecretBox('a sufficiently long test master secret'),
    (_token, config) => {
      settings.push(config);
      return {
        client: client as unknown as Client,
        async request(_method, path) {
          if (path === '/users/@me')
            return { id: '1', username: 'bot', bot: true, avatar: null };
          return guilds.map(({ id, name }) => ({ id, name }));
        },
        async login() {},
        async voice() {},
        destroy() {},
        status() {
          return { state: 'online', guilds: 2 };
        },
      };
    },
  );
  await manager.save('bot', 'token', ['features']);
  let bot = store.bots()[0];
  await manager.updateGateway(bot, { intents, messageCacheSize: 200 });
  bot = store.bots()[0];
  // Direct dispatch gives deterministic completion while exercising the same production engine.
  const engine = new FeatureEngine(store, bot, client as unknown as Client);
  const member = (index: number) => ({
    id: '42',
    guild: guilds[index],
    user: { id: '42', bot: false },
    roles: {
      add: async (roles: unknown) => {
        assigned.push({ index, roles });
      },
    },
  });
  const message = (index: number) => ({
    id: '50',
    guild: guilds[index],
    channelId: '30',
    content: 'cached text',
    author: { id: '42', bot: false },
  });
  return {
    store,
    manager,
    bot,
    engine,
    sent,
    assigned,
    member,
    message,
    settings,
    close() {
      engine.close();
      manager.close();
      store.close();
    },
  };
}

test('two guild isolation, uncached honesty, loop protection, and live disable', async () => {
  const f = await setup();
  try {
    assert.equal(f.store.featureInstances('1').length, 0);
    await f.manager.configureFeature(
      f.bot,
      '10',
      'logging',
      { channelId: '99' },
      true,
    );
    await f.manager.configureFeature(
      f.bot,
      '20',
      'autorole',
      { roleIds: ['88'] },
      true,
    );
    await f.engine.dispatch('messageDelete', f.message(0));
    await f.engine.dispatch('messageDelete', f.message(1));
    assert.equal(f.sent.length, 1);
    await f.engine.dispatch('guildMemberAdd', f.member(1));
    await f.engine.dispatch('guildMemberAdd', f.member(0));
    assert.equal(f.assigned.length, 1);
    await f.engine.dispatch('messageDelete', {
      ...f.message(0),
      channelId: '99',
    });
    assert.equal(f.sent.length, 2); // member join in A was logged
    await f.engine.dispatch('messageDelete', {
      ...f.message(0),
      partial: true,
      content: undefined,
      author: undefined,
    });
    assert.match(JSON.stringify(f.sent.at(-1)), /unavailable/);
    await f.manager.configureFeature(f.bot, '10', 'logging', undefined, false);
    const count = f.sent.length;
    await f.engine.dispatch('messageDelete', f.message(0));
    assert.equal(f.sent.length, count);
  } finally {
    f.close();
  }
});

test('missing member intent degrades status and skips only member events', async () => {
  const f = await setup([
    'Guilds',
    'GuildMessages',
    'GuildModeration',
    'MessageContent',
  ]);
  try {
    await f.manager.configureFeature(
      f.bot,
      '10',
      'logging',
      { channelId: '99' },
      true,
    );
    await f.engine.dispatch('guildMemberAdd', f.member(0));
    assert.equal(f.sent.length, 0);
    await f.engine.dispatch('messageDelete', f.message(0));
    assert.equal(f.sent.length, 1);
    const status = f.manager.featureStates(f.bot, '10')[0];
    assert.equal(status.state, 'degraded');
    assert.deepEqual(status.missingIntents, ['GuildMembers']);
    const session = new Session(f.store, f.manager);
    const response = await session.call('list_features', { guild: '10' });
    assert.match(response.content[0].text, /degraded/);
    assert.match(response.content[0].text, /GuildMembers/);
    session.close();
  } finally {
    f.close();
  }
});

test('configured privileged intent is passed exactly to connection and discord client', async () => {
  const f = await setup(['GuildMembers']);
  try {
    assert.deepEqual(f.settings.at(-1), {
      intents: ['GuildMembers'],
      messageCacheSize: 200,
    });
    assert.equal(f.manager.status('bot').state, 'online');
    const connection = discordConnection('fake', {
      intents: ['GuildMembers'],
      messageCacheSize: 7,
    });
    assert.equal(
      connection.client!.options.intents.bitfield,
      GatewayIntentBits.GuildMembers,
    );
    connection.destroy();
  } finally {
    f.close();
  }
});

test('MCP and UI backing state parity, audit, all scope, ambiguity and validation atomicity', async () => {
  const f = await setup();
  const session = new Session(f.store, f.manager);
  try {
    await f.manager.configureFeature(
      f.bot,
      'all',
      'logging',
      { channelId: '99' },
      true,
    );
    const response = await session.call('configure_feature', {
      guild: '10',
      feature_id: 'logging',
      config: { channelId: '98' },
    });
    assert.equal(response.isError, undefined);
    assert.equal(
      f.manager.featureStates(f.bot, '10')[0].config?.channelId,
      '98',
    );
    assert.equal(
      f.manager.featureStates(f.bot, '20')[0].config?.channelId,
      '99',
    );
    assert.equal(f.store.auditEntries()[0].tool, 'configure_feature');
    await assert.rejects(f.manager.resolveGuilds(f.bot, 'Server'), /10.*20/);
    await assert.rejects(
      f.manager.configureFeature(f.bot, 'all', 'logging', { channelId: 'bad' }),
    );
    assert.equal(
      f.manager.featureStates(f.bot, '10')[0].config?.channelId,
      '98',
    );
  } finally {
    session.close();
    f.close();
  }
});

test('a throwing handler leaves other features and connection functional', async () => {
  const f = await setup();
  try {
    await f.manager.configureFeature(
      f.bot,
      '10',
      'logging',
      { channelId: '99' },
      true,
    );
    await f.manager.configureFeature(
      f.bot,
      '10',
      'autorole',
      { roleIds: ['88'] },
      true,
    );
    const engine = new FeatureEngine(
      f.store,
      f.bot,
      new EventEmitter() as unknown as Client,
      [
        {
          ...features[0],
          events: [
            {
              name: 'guildMemberAdd',
              intents: ['GuildMembers'],
              async handle() {
                throw new Error('malformed');
              },
            },
          ],
        },
        features[1],
      ],
    );
    await engine.dispatch('guildMemberAdd', f.member(0));
    assert.equal(f.assigned.length, 1);
    assert.equal(f.manager.status('bot').state, 'online');
    engine.close();
  } finally {
    f.close();
  }
});

test('slash command lifecycle only creates and deletes owned commands', async () => {
  const f = await setup();
  const { Collection } = await import('discord.js');
  const commands = new Collection<string, { id: string; name: string }>([
    ['unrelated', { id: 'unrelated', name: 'external' }],
  ]);
  const deleted: string[] = [];
  const client = Object.assign(new EventEmitter(), {
    isReady: () => true,
    guilds: {
      cache: new Map([
        [
          '10',
          {
            id: '10',
            commands: {
              fetch: async () => commands,
              create: async (body: { name: string }) => {
                const command = { id: 'owned', name: body.name };
                commands.set('owned', command);
                return command;
              },
              delete: async (id: string) => {
                deleted.push(id);
                commands.delete(id);
              },
            },
          },
        ],
      ]),
    },
  });
  const engine = new FeatureEngine(
    f.store,
    f.bot,
    client as unknown as Client,
    [
      {
        ...features[1],
        slashCommands: [
          { name: 'greet', description: 'Greet', async handle() {} },
        ],
      },
    ],
  );
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  try {
    await f.manager.configureFeature(
      f.bot,
      '10',
      'autorole',
      { roleIds: ['88'] },
      true,
    );
    await flush();
    assert.equal(commands.size, 2);
    await f.manager.configureFeature(f.bot, '10', 'autorole', undefined, false);
    await flush();
    assert.deepEqual(deleted, ['owned']);
    assert.ok(commands.has('unrelated'));
  } finally {
    engine.close();
    f.close();
  }
});
