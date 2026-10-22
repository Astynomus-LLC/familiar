/* eslint-disable @typescript-eslint/no-explicit-any -- Mocks model only the Discord boundary used by each test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PermissionFlagsBits as P } from 'discord.js';
import { Store } from '../src/storage/store.js';
import { FeatureEngine } from '../src/features/engine.js';
import { moderationFeature } from '../src/features/moderation.js';
import { fixture } from './helpers.js';
import { Session } from '../src/mcp/session.js';

function setup(contentIntent = true) {
  const store = new Store(':memory:');
  const bot: any = {
    id: '1',
    slug: 'bot',
    name: 'Bot',
    token: '',
    categories: [],
    intents: [
      'Guilds',
      'GuildMessages',
      ...(contentIntent ? ['MessageContent'] : []),
    ],
  };
  const calls: any[] = [];
  const highest = { comparePositionTo: () => 1 };
  const user = {
    id: '42',
    bot: false,
    send: async (body: any) => {
      calls.push(['dm', body]);
    },
  };
  const member: any = {
    id: '42',
    user,
    roles: { highest: {}, cache: new Map() },
    moderatable: true,
    kickable: true,
    bannable: true,
    timeout: async (...args: any[]) => {
      calls.push(['timeout', ...args]);
    },
    kick: async () => {
      calls.push(['kick']);
    },
    ban: async () => {
      calls.push(['ban']);
    },
  };
  const guild: any = {
    id: '10',
    name: 'Server A',
    ownerId: '99',
    members: {
      me: { permissions: { has: () => true }, roles: { highest } },
      fetch: async (id: string) =>
        id === '7' ? { roles: { highest } } : member,
    },
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (body: any) => {
          calls.push(['log', body]);
        },
      }),
    },
  };
  const client: any = Object.assign(new EventEmitter(), {
    user: { id: '1' },
    isReady: () => false,
    guilds: { cache: new Map([['10', guild]]) },
    users: { fetch: async () => user },
  });
  const engine = new FeatureEngine(store, bot, client);
  store.on('moderationAction', (event) => calls.push(['hook', event]));
  const enable = (featureId: string, config: any = {}) =>
    store.saveFeatureInstances([
      { botId: '1', guildId: '10', featureId, config, enabled: true },
    ]);
  const module = (moduleId: string, config: any) =>
    store.saveModuleInstances([
      { botId: '1', guildId: '10', moduleId, config, enabled: true },
    ]);
  enable('moderation.commands');
  enable('logging.memberModerated');
  module('logging', { channelId: '100' });
  store.setSetting(
    'featureCommands:1:10',
    Object.fromEntries(
      moderationFeature.slashCommands!.map((c) => [
        c.name,
        { id: c.name, feature: 'moderation.commands' },
      ]),
    ),
  );
  const message = (content: string, extra = {}) => ({
    guild,
    author: user,
    member,
    content,
    channelId: '50',
    channel: { permissionsFor: () => ({ has: () => true }) },
    delete: async () => {
      calls.push(['delete']);
    },
    ...extra,
  });
  const command = async (name: string, opts: any = {}, permitted = true) => {
    const interaction: any = {
      guild,
      user: { id: '7' },
      memberPermissions: { has: () => permitted },
      member: { roles: [] },
      commandName: name,
      commandId: name,
      isChatInputCommand: () => true,
      options: {
        getUser: () => user,
        getString: (key: string) => opts[key] ?? 'Testing reason',
        getInteger: (key: string) => opts[key] ?? null,
      },
      reply: async (body: any) => {
        calls.push(['reply', body]);
      },
      deferReply: async () => {},
      editReply: async (body: any) => {
        calls.push(['reply', body]);
        return {};
      },
    };
    await engine.dispatch('interactionCreate', interaction);
  };
  return {
    store,
    engine,
    calls,
    member,
    guild,
    bot,
    enable,
    module,
    message,
    command,
    close: () => {
      engine.close();
      store.close();
    },
  };
}

test('automod deletes and warns, emits logging hook, honors exemptions and stores no message content', async () => {
  const f = setup();
  try {
    f.enable('automod.word-filter', {
      words: ['bad', 'a.b'],
      action: 'delete_and_warn',
    });
    await f.engine.dispatch(
      'messageCreate',
      f.message('bad private message text'),
    );
    assert.equal(f.calls.filter((c) => c[0] === 'delete').length, 1);
    const [entry] = f.store.modCases('10');
    assert.equal(entry.actor, 'automod:word-filter');
    assert.equal(entry.action, 'warn');
    assert.deepEqual(entry.metadata, {
      feature: 'word-filter',
      matched: 'bad',
    });
    assert.ok(!JSON.stringify(entry).includes('private message text'));
    assert.ok(f.calls.some((c) => c[0] === 'hook'));
    assert.ok(f.calls.some((c) => c[0] === 'log'));
    f.module('automod', { exemptRoles: ['88'], exemptChannels: ['60'] });
    f.member.roles.cache.set('88', {});
    await f.engine.dispatch('messageCreate', f.message('bad'));
    f.member.roles.cache.clear();
    await f.engine.dispatch(
      'messageCreate',
      f.message('bad', { channelId: '60' }),
    );
    await f.engine.dispatch(
      'messageCreate',
      f.message('bad', { author: { id: '12', bot: true } }),
    );
    await f.engine.dispatch('messageCreate', f.message('badger axb'));
    assert.equal(f.store.modCases('10').length, 1);
    await f.engine.dispatch('messageCreate', f.message('a.b'));
    assert.equal(f.store.modCases('10').length, 2);
    f.guild.members.me.roles.highest.comparePositionTo = () => -1;
    await f.engine.dispatch('messageCreate', f.message('bad'));
    assert.equal(f.store.modCases('10').length, 2);
    assert.match(f.store.auditEntries()[0].result, /hierarchy/);
  } finally {
    f.close();
  }
});

test('link allowlist, deceptive suffix, and invite override', async () => {
  const f = setup();
  try {
    f.enable('automod.link-filter', {
      mode: 'block_except_allowlist',
      allowlist: ['example.com', 'discord.gg'],
      block_invites: true,
      action: 'delete',
    });
    for (const text of ['https://example.com', 'https://sub.example.com/path'])
      await f.engine.dispatch('messageCreate', f.message(text));
    assert.equal(f.calls.length, 0);
    for (const text of [
      'https://other.com',
      'https://example.com.evil.com',
      'discord.gg/invite',
    ])
      await f.engine.dispatch('messageCreate', f.message(text));
    assert.equal(f.calls.filter((c) => c[0] === 'delete').length, 3);
    assert.equal(f.store.modCases('10').length, 0);
    assert.equal(f.calls.filter((c) => c[0] === 'hook').length, 3);
  } finally {
    f.close();
  }
});

test('warn runtime permissions, per-guild sequence/history, DM, void, and escalation', async () => {
  const f = setup();
  try {
    f.module('moderation', {
      thresholds: [{ count: 3, action: 'timeout', duration: '1h' }],
    });
    await f.command('warn', {}, false);
    assert.equal(f.store.modCases('10').length, 0);
    assert.equal(f.calls[0][1].ephemeral, true);
    f.store.createCase({
      bot_id: '2',
      guild_id: '20',
      user_id: '42',
      actor: 'other',
      action: 'warn',
      reason: 'Other server secret',
    });
    await f.command('warn');
    assert.equal(f.store.modCases('10')[0].case_number, 1);
    assert.ok(
      f.calls.some((c) => c[0] === 'dm' && c[1].content.includes('Server A')),
    );
    assert.ok(
      f.calls.some(
        (c) => c[0] === 'reply' && c[1].content?.includes('Case #1'),
      ),
    );
    await f.command('warn');
    await f.command('warn');
    assert.equal(f.calls.filter((c) => c[0] === 'timeout').length, 1);
    assert.equal(f.calls.find((c) => c[0] === 'timeout')[1], 3600000);
    assert.equal(f.store.modCases('10')[0].actor, 'system:warn-escalation');
    assert.equal(f.store.activeWarnCount('10', '42'), 3);
    await f.command('modlogs');
    const reply = f.calls.at(-1)[1];
    assert.equal(reply.embeds.length, 4);
    assert.ok(!JSON.stringify(reply).includes('Other server secret'));
    await f.command('voidcase', { 'case-number': 1 });
    assert.equal(f.store.activeWarnCount('10', '42'), 2);
    assert.equal(f.store.activeWarnCount('20', '42'), 1);
    assert.equal(f.store.modCase('10', 1)?.active, false);
    assert.equal(f.store.modCase('20', 1)?.active, true);
  } finally {
    f.close();
  }
});

test('missing MessageContent disables automod while moderation still works; action failure writes no case', async () => {
  const f = setup(false);
  try {
    f.enable('automod.word-filter', {
      words: ['bad'],
      action: 'delete_and_warn',
    });
    await f.engine.dispatch('messageCreate', f.message('bad'));
    assert.equal(f.calls.length, 0);
    await f.command('warn');
    assert.equal(f.store.modCases('10').length, 1);
    f.member.kick = async () => {
      throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
    };
    await f.command('kick');
    assert.equal(f.store.modCases('10').length, 1);
    assert.match(f.calls.at(-1)[1].content, /permissions and role hierarchy/);
  } finally {
    f.close();
  }
});

test('attachment, mention, caps, and nonconsecutive repeated-message filters', async () => {
  for (const [id, config, messages] of [
    [
      'attachment-filter',
      { blockImages: true },
      [{ attachments: new Map([['a', { contentType: 'image/png' }]]) }],
    ],
    [
      'mention-limit',
      { maxUserMentions: 1 },
      [
        {
          mentions: {
            users: new Map([
              ['1', {}],
              ['2', {}],
            ]),
            roles: new Map(),
          },
        },
      ],
    ],
    [
      'caps-filter',
      { minLength: 3, maxCapsPercentage: 50 },
      [{ content: 'LOUD' }],
    ],
    [
      'repeat-filter',
      { repeatCount: 3 },
      [
        { content: 'same' },
        { content: 'different' },
        { content: 'same' },
        { content: 'same' },
      ],
    ],
  ] as const) {
    const f = setup();
    try {
      f.enable(`automod.${id}`, { ...config, action: 'warn' });
      for (const message of messages)
        await f.engine.dispatch('messageCreate', f.message('', message));
      assert.equal(f.store.modCases('10').length, 1, id);
    } finally {
      f.close();
    }
  }
});

test('command registration definitions have exact options and permission defaults', () => {
  for (const command of moderationFeature.slashCommands!)
    assert.ok(command.defaultMemberPermissions);
  assert.equal(
    moderationFeature.slashCommands!.find((c) => c.name === 'warn')!
      .defaultMemberPermissions,
    P.ModerateMembers,
  );
  for (const [name, expected] of Object.entries({
    ban: ['member', 'reason', 'delete-messages'],
    kick: ['member', 'reason'],
    timeout: ['member', 'duration', 'reason'],
    unban: ['user-id', 'reason'],
    untimeout: ['member'],
  }))
    assert.deepEqual(
      moderationFeature
        .slashCommands!.find((c) => c.name === name)!
        .options!.map((o) => o.name),
      expected,
    );
});

test('agent tool ban records labeled case; MCP hides inaccessible bots and rejects all-guild history', async () => {
  const f = await fixture();
  const bot = f.store.bots()[0];
  f.store.saveBot({ ...bot, categories: ['moderation', 'features'] });
  const { key } = f.store.createKey({
    label: 'Test agent',
    bots: [bot.slug],
    readOnly: false,
    categories: null,
  });
  const session = new Session(f.store, f.manager, key.id);
  const read = (result: any) => JSON.parse(result.content[0].text).result;
  try {
    const args = { guild_id: '10', user_id: '42', reason: 'Agent reason' };
    const pending = read(await session.call('moderation_ban', args));
    const result = await session.call('moderation_ban', {
      ...args,
      confirmation: pending.code,
    });
    assert.ok(!result.isError);
    assert.equal(f.store.modCases('10')[0].actor, 'agent:Test agent');
    const logs = read(
      await session.call('get_modlogs', { guild: 'Server A', user: '42' }),
    );
    assert.ok(JSON.stringify(logs).includes('Agent reason'));
    assert.ok(
      (await session.call('get_modlogs', { guild: 'all', user: '42' })).isError,
    );
    assert.ok(
      (
        await session.call('get_modlogs', {
          guild: '20',
          user: '42',
          bot: 'other',
        })
      ).isError,
    );
    assert.equal(f.store.modCases('20').length, 0);
  } finally {
    session.close();
    f.manager.close();
    f.store.close();
  }
});

test('automod warnings use the shared moderation escalation thresholds', async () => {
  const f = setup();
  try {
    f.module('moderation', { thresholds: [{ count: 2, action: 'kick' }] });
    f.enable('automod.word-filter', { words: ['bad'], action: 'warn' });
    await f.command('warn');
    await f.engine.dispatch('messageCreate', f.message('bad'));
    assert.equal(f.calls.filter((c) => c[0] === 'kick').length, 1);
    assert.equal(f.store.modCases('10')[0].actor, 'system:warn-escalation');
    assert.equal(f.store.modCases('10')[0].case_number, 3);
  } finally {
    f.close();
  }
});

test('case sequences are shared across bots in a guild and voids never reuse a number', () => {
  const store = new Store(':memory:');
  try {
    const input = {
      bot_id: '1',
      guild_id: '10',
      user_id: '42',
      actor: '7',
      action: 'warn' as const,
      reason: 'Reason',
    };
    assert.equal(store.createCase(input).case_number, 1);
    store.voidCase('10', 1);
    assert.equal(store.createCase({ ...input, bot_id: '2' }).case_number, 2);
    assert.equal(store.createCase({ ...input, guild_id: '20' }).case_number, 1);
    assert.equal(store.activeWarnCount('10', '42'), 1);
    assert.equal(store.modCases('10', '42', 2)[0].active, false);
    assert.equal(store.modCase('20', 2), undefined);
  } finally {
    store.close();
  }
});
