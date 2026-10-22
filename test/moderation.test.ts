/* eslint-disable @typescript-eslint/no-explicit-any -- Mocks model only the Discord boundary used by each test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Collection, PermissionFlagsBits as P } from 'discord.js';
import { Store } from '../src/storage/store.js';
import { FeatureEngine } from '../src/features/engine.js';
import { moderationFeature } from '../src/features/moderation.js';
import { fixture } from './helpers.js';
import { moderation } from '../src/tools/categories/moderation.js';
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
    channel: {
      permissionsFor: () => ({ has: () => true }),
      send: async () => ({ delete: async () => {} }),
    },
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
      channelId: '50',
      commandName: name,
      commandId: name,
      isChatInputCommand: () => true,
      options: {
        getChannel: () => opts.channel ?? null,
        getUser: () => (name === 'purge' ? (opts.member ? user : null) : user),
        getString: (key: string) => opts[key] ?? 'Testing reason',
        getInteger: (key: string) => opts[key] ?? null,
      },
      reply: async (body: any) => {
        calls.push(['reply', body]);
      },
      deferReply: async (body: any) => {
        calls.push(['defer', body]);
      },
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
    client,
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
      channel: '<#50>',
      jump: '',
      outcome: 'delete_and_warn',
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
      f.calls.some(
        (c) => c[0] === 'dm' && c[1].embeds[0].title.includes('Server A'),
      ),
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
    purge: ['count', 'member', 'channel'],
    lock: ['channel', 'reason'],
    unlock: ['channel'],
    slowmode: ['seconds', 'channel'],
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
    const args = {
      guild_id: '10',
      member: '42',
      reason: 'Agent reason',
      delete_messages: 60,
    };
    const pending = read(await session.call('ban_member', args));
    const result = await session.call('ban_member', {
      ...args,
      confirmation: pending.code,
    });
    assert.ok(!result.isError);
    assert.equal(f.store.modCases('10')[0].actor, 'agent:Test agent');
    assert.equal(f.store.modCases('10')[0].reason, 'Agent reason');
    assert.ok(
      f.calls.some(
        (c) =>
          c.method === 'PUT' &&
          c.path === '/guilds/10/bans/42' &&
          (c.body as any).delete_message_seconds === 60,
      ),
    );
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

test('moderation member tools put member and reason before extras', () => {
  for (const [name, extras] of Object.entries({
    ban_member: ['delete_messages'],
    kick_member: [],
    timeout_member: ['duration'],
    warn_member: [],
  })) {
    const tool = moderation.tools.find((tool) => tool.name === name)!;
    assert.deepEqual(Object.keys(tool.schema.shape), [
      'guild_id',
      'member',
      'reason',
      ...extras,
    ]);
    assert.match(tool.description, /reason is recorded in the server modlog/);
  }
});

test('agent warnings share notifications and escalations and respect disabled moderation', async () => {
  for (const mode of [
    'enabled',
    'disabled',
    'dm-disabled',
    'dm-failed',
  ] as const) {
    const discord = setup();
    discord.client.guilds.fetch = async () => discord.guild;
    if (mode === 'dm-failed')
      discord.member.user.send = async () => {
        throw new Error('Closed DMs');
      };
    const f = await fixture(discord.client);
    const bot = f.store.bots()[0];
    f.store.saveBot({ ...bot, categories: ['moderation'] });
    f.store.saveModuleInstances([
      {
        botId: bot.id,
        guildId: '10',
        moduleId: 'moderation',
        enabled: mode !== 'disabled',
        config: {
          dmSubject: mode !== 'dm-disabled',
          thresholds: [{ count: 1, action: 'timeout', duration: '1h' }],
        },
      },
    ]);
    const { key } = f.store.createKey({
      label: 'Warn agent',
      bots: [bot.slug],
      readOnly: false,
      categories: null,
    });
    const session = new Session(f.store, f.manager, key.id);
    try {
      const result = await session.call('warn_member', {
        guild_id: '10',
        member: '42',
        reason: 'Agent warning',
      });
      assert.ok(!result.isError, JSON.stringify(result));
      const entry = f.store.modCase('10', 1)!;
      assert.equal(entry.actor, 'agent:Warn agent');
      assert.equal(entry.reason, 'Agent warning');
      assert.equal(entry.action, 'warn');
      assert.equal(f.store.activeWarnCount('10', '42'), 1);
      if (mode === 'disabled') {
        assert.equal(f.store.modCases('10').length, 1);
        assert.ok(!discord.calls.some((c) => ['dm', 'timeout'].includes(c[0])));
        assert.match(
          result.content[0].text,
          /Moderation is disabled.*no DM or escalation/,
        );
      } else {
        assert.equal(f.store.modCase('10', 2)?.actor, 'system:warn-escalation');
        assert.ok(
          discord.calls.some((c) => c[0] === 'timeout' && c[1] === 3600000),
        );
        if (mode === 'enabled')
          assert.ok(
            discord.calls.some(
              (c) =>
                c[0] === 'dm' &&
                c[1].embeds[0].title.includes('Server A') &&
                c[1].embeds[0].fields.some(
                  (field: any) =>
                    field.name === 'Reason' && field.value === 'Agent warning',
                ),
            ),
          );
        else assert.ok(!discord.calls.some((c) => c[0] === 'dm'));
      }
    } finally {
      session.close();
      f.manager.close();
      f.store.close();
      discord.close();
    }
  }
});

function channelSetup() {
  const f = setup();
  let overwrite: any = null;
  let messages: any[] = [];
  const channel: any = {
    id: '50',
    guild: f.guild,
    permissionsFor: () => ({ has: () => true }),
    permissionOverwrites: {
      cache: new Map(),
      delete: async () => {
        overwrite = null;
        f.calls.push(['overwrite-delete']);
      },
    },
    messages: {
      fetch: async ({ limit, before }: any) => {
        const start = before
          ? messages.findIndex((m) => m.id === before) + 1
          : 0;
        return new Collection(
          messages.slice(start, start + limit).map((m) => [m.id, m]),
        );
      },
    },
    bulkDelete: async (selected: any) => {
      f.calls.push(['bulk', [...selected.keys()]]);
      return selected;
    },
    setRateLimitPerUser: async (seconds: number) => {
      f.calls.push(['slowmode', seconds]);
    },
  };
  f.guild.channels.fetch = async () => channel;
  f.client.channels = { fetch: async () => channel };
  f.client.rest = {
    put: async (_path: string, { body }: any) => {
      overwrite = body;
      f.calls.push(['overwrite', body]);
    },
  };
  return {
    ...f,
    channel,
    overwrite: () => overwrite,
    messages: (n: number) => {
      messages = Array.from({ length: n }, (_, i) => ({
        id: String(1000 - i),
        author: { id: i % 2 ? '43' : '42' },
        createdTimestamp: Date.now() - 1000,
      }));
      return messages;
    },
  };
}

test('purge chunks recent messages, reports actual deletion, and writes only targeted cases', async () => {
  const f = channelSetup();
  try {
    f.messages(150)[149].createdTimestamp = Date.now() - 15 * 86400000;
    await f.command('purge', { count: 150 });
    assert.deepEqual(
      f.calls.filter((c) => c[0] === 'bulk').map((c) => c[1].length),
      [100, 49],
    );
    assert.match(f.calls.at(-1)[1].content, /149/);
    assert.equal(f.calls.find((c) => c[0] === 'defer')[1].ephemeral, true);
    assert.equal(f.store.modCases('10').length, 0);
    assert.equal(f.calls.filter((c) => c[0] === 'hook').length, 1);
    f.messages(20);
    await f.command('purge', { count: 20, member: true });
    assert.equal(f.store.modCases('10')[0].action, 'purge');
    assert.equal(f.store.modCases('10')[0].actor, '7');
    assert.equal(f.store.modCases('10')[0].user_id, '42');
    assert.equal(f.store.modCases('10')[0].metadata.deleted, '10');
  } finally {
    f.close();
  }
});

test('lock restores exact overwrite or removes it; unknown unlock and duplicate lock do not mutate', async () => {
  for (const custom of [true, false]) {
    const f = channelSetup();
    try {
      const prior = {
        allow: (P.SendMessages | P.AttachFiles).toString(),
        deny: P.AddReactions.toString(),
        type: 0,
      };
      if (custom)
        f.channel.permissionOverwrites.cache.set('10', {
          allow: { bitfield: BigInt(prior.allow) },
          deny: { bitfield: BigInt(prior.deny), has: () => false },
          type: 0,
        });
      await f.command('unlock');
      assert.match(f.calls.at(-1)[1].content, /did not lock/);
      assert.equal(
        f.calls.filter((c) => c[0].startsWith('overwrite')).length,
        0,
      );
      await f.command('lock');
      await f.command('lock');
      assert.match(f.calls.at(-1)[1].content, /already locked/);
      assert.equal(f.calls.filter((c) => c[0] === 'overwrite').length, 1);
      await f.command('unlock');
      assert.deepEqual(f.overwrite(), custom ? prior : null);
      assert.equal(f.store.setting('moderationLock:1:10:50'), null);
      assert.equal(f.calls.filter((c) => c[0] === 'hook').length, 2);
      assert.equal(f.store.modCases('10').length, 0);
    } finally {
      f.close();
    }
  }
});

test('slowmode and channel permission failures are ephemeral and do not mutate', async () => {
  const f = channelSetup();
  try {
    await f.command('slowmode', { seconds: 0 });
    assert.match(f.calls.at(-1)[1].content, /off/);
    await f.command('slowmode', { seconds: 300 });
    assert.match(f.calls.at(-1)[1].content, /5m/);
    assert.deepEqual(
      f.calls.filter((c) => c[0] === 'slowmode').map((c) => c[1]),
      [0, 300],
    );
    f.calls.length = 0;
    for (const name of ['purge', 'lock', 'unlock', 'slowmode'])
      await f.command(name, {}, false);
    assert.ok(f.calls.every((c) => c[0] === 'reply' && c[1].ephemeral));
    f.calls.length = 0;
    f.channel.permissionsFor = () => ({ has: () => false });
    await f.command('lock');
    assert.match(f.calls.at(-1)[1].content, /permission/);
    assert.equal(f.store.setting('moderationLock:1:10:50'), undefined);
    assert.equal(f.store.modCases('10').length, 0);
  } finally {
    f.close();
  }
});

test('MCP channel moderation shares cases, lock restoration, validation and permission checks', async () => {
  const d = channelSetup();
  const f = await fixture(d.client);
  const bot = f.store.bots()[0];
  f.store.saveBot({ ...bot, categories: ['moderation'] });
  const { key } = f.store.createKey({
    label: 'Channel agent',
    bots: [bot.slug],
    readOnly: false,
    categories: null,
  });
  const session = new Session(f.store, f.manager, key.id);
  try {
    d.messages(20);
    for (const [name, args] of [
      [
        'purge_messages',
        { channel: '50', count: 20, member: '42', reason: 'Cleanup' },
      ],
      ['lock_channel', { channel: '50', reason: 'Quiet' }],
      ['unlock_channel', { channel: '50' }],
      ['set_slowmode', { channel: '50', seconds: 300 }],
    ] as const) {
      let result = await session.call(name, args);
      const pending = JSON.parse(result.content[0].text).result;
      if (pending.confirmation_required)
        result = await session.call(name, {
          ...args,
          confirmation: pending.code,
        });
      assert.ok(!result.isError, JSON.stringify(result));
    }
    assert.equal(f.store.modCases('10')[0].actor, 'agent:Channel agent');
    assert.equal(f.store.modCases('10')[0].action, 'purge');
    assert.equal(d.overwrite(), null);
    assert.equal(
      (await session.call('purge_messages', { channel: '50', count: 501 }))
        .isError,
      true,
    );
    assert.equal(
      (await session.call('set_slowmode', { channel: '50', seconds: 21601 }))
        .isError,
      true,
    );
    d.calls.length = 0;
    d.channel.permissionsFor = () => ({ has: () => false });
    for (const name of [
      'purge_messages',
      'lock_channel',
      'unlock_channel',
      'set_slowmode',
    ]) {
      const args = { channel: '50', count: 20, seconds: 0 };
      let result = await session.call(name, args);
      const pending = JSON.parse(result.content[0].text).result;
      if (pending.confirmation_required)
        result = await session.call(name, {
          ...args,
          confirmation: pending.code,
        });
      assert.equal(result.isError, true);
    }
    assert.equal(d.calls.length, 0);
    assert.equal(f.store.modCases('10').length, 1);
  } finally {
    session.close();
    f.manager.close();
    f.store.close();
    d.close();
  }
});

test('lock rejection clears state, ambiguous failure preserves recovery, and failed unlock retains state', async () => {
  const f = channelSetup();
  try {
    f.client.rest.put = async () => {
      throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
    };
    await f.command('lock');
    assert.equal(f.store.setting('moderationLock:1:10:50'), null);
    assert.equal(f.calls.filter((c) => c[0] === 'hook').length, 0);
    f.client.rest.put = async () => {
      throw new Error('Network timeout');
    };
    await f.command('lock');
    assert.deepEqual(f.store.setting('moderationLock:1:10:50'), {
      overwrite: null,
    });
    f.channel.permissionOverwrites.delete = async () => {
      throw new Error('Network timeout');
    };
    await f.command('unlock');
    assert.deepEqual(f.store.setting('moderationLock:1:10:50'), {
      overwrite: null,
    });
    assert.equal(f.store.modCases('10').length, 0);
  } finally {
    f.close();
  }
});

test('purge counts actual results and records partial completion when a later batch fails', async () => {
  const f = channelSetup();
  try {
    f.messages(150);
    let calls = 0;
    f.channel.bulkDelete = async (messages: any) => {
      if (++calls === 2) throw new Error('Discord unavailable');
      return new Collection([...messages].slice(0, 48));
    };
    await f.command('purge', { count: 150, member: true });
    assert.match(f.calls.at(-1)[1].content, /48 messages.*failed/);
    assert.equal(f.store.modCases('10')[0].metadata.deleted, '48');
    assert.equal(f.calls.filter((c) => c[0] === 'hook').length, 1);
  } finally {
    f.close();
  }
});
