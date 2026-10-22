/* eslint-disable @typescript-eslint/no-explicit-any -- Discord boundary mocks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { FeatureEngine } from '../src/features/engine.js';
import {
  createPanel,
  historyBody,
  sendCase,
} from '../src/features/components.js';
import { caseEmbed, palette } from '../src/features/presentation.js';
import type { ModAction } from '../src/storage/cases.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'familiar-panels-'));
  let store = new Store(join(dir, 'store.db'));
  const posts = new Map<string, any>();
  const replies: any[] = [];
  let permitted = true;
  let timeouts = 0;
  let deleted = 0;
  const highest = { comparePositionTo: () => 1 };
  const user = {
    id: '42',
    tag: 'Subject#1234',
    displayAvatarURL: () => 'https://example.com/avatar.png',
    send: async () => {},
  };
  const moderator = {
    permissions: { has: () => permitted },
    roles: { highest, cache: new Map() },
  };
  const subject = {
    id: '42',
    user,
    moderatable: true,
    roles: { highest: {}, cache: new Map() },
    timeout: async () => {
      timeouts++;
    },
  };
  const channel: any = {
    id: '50',
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: async (body: any) => {
      const id = String(posts.size + 1);
      const message = {
        id,
        channelId: '50',
        ...body,
        delete: async () => {
          deleted++;
        },
        edit: async (body: any) => {
          Object.assign(message, body);
        },
      };
      posts.set(id, message);
      return message;
    },
    messages: {
      edit: async (id: string, body: any) => {
        Object.assign(posts.get(id), body);
      },
    },
  };
  const guild: any = {
    id: '10',
    name: 'Test server',
    ownerId: '99',
    iconURL: () => 'https://example.com/server.png',
    channels: { fetch: async () => channel },
    members: {
      me: { permissions: { has: () => true }, roles: { highest } },
      fetch: async (arg: any) =>
        (arg.user ?? arg) === '42' ? subject : moderator,
    },
  };
  const client: any = Object.assign(new EventEmitter(), {
    user: { id: '1' },
    users: { cache: new Map([['42', user]]), fetch: async () => user },
    isReady: () => false,
  });
  const bot: any = {
    id: '1',
    slug: 'bot',
    intents: ['Guilds', 'GuildMessages', 'MessageContent'],
  };
  let engine = new FeatureEngine(store, bot, client);
  const ctx = (): any => ({
    store,
    bot,
    guild,
    client,
    config: {},
    enabledFeatures: [],
    intents: bot.intents,
    active: () => true,
    logger: () => {},
  });
  const add = (action: ModAction = 'warn', actor = '7') =>
    store.createCase({
      bot_id: '1',
      guild_id: '10',
      user_id: '42',
      actor,
      action,
      reason: 'Reason',
    });
  const click = async (
    customId: string,
    message: any,
    values?: string[],
    userId = '7',
  ) => {
    const i: any = {
      customId,
      guild,
      channelId: '50',
      user: { id: userId },
      message,
      values,
      reply: async (body: any) => {
        replies.push(body);
        i.replied = true;
      },
      update: async (body: any) => {
        Object.assign(message, body);
        i.replied = true;
      },
      deferReply: async () => {
        i.deferred = true;
        i.replyMode = true;
      },
      deferUpdate: async () => {
        i.deferred = true;
      },
      editReply: async (body: any) => {
        if (i.replyMode) replies.push(body);
        else Object.assign(message, body);
      },
    };
    await engine.dispatch('interactionCreate', i);
  };
  return {
    ctx,
    posts,
    replies,
    add,
    click,
    channel,
    guild,
    user,
    deny: () => {
      permitted = false;
    },
    allow: () => {
      permitted = true;
    },
    timeouts: () => timeouts,
    deleted: () => deleted,
    restart: () => {
      engine.close();
      store.close();
      store = new Store(join(dir, 'store.db'));
      engine = new FeatureEngine(store, bot, client);
    },
    dispatch: (name: string, value: any) => engine.dispatch(name, value),
    close: () => {
      engine.close();
      store.close();
      rmSync(dir, { recursive: true });
    },
  };
}

test('canonical embeds share palette, fields, identity and footer on reply, DM and announce', () => {
  const f = fixture();
  try {
    for (const action of [
      'warn',
      'kick',
      'ban',
      'unban',
      'timeout',
      'untimeout',
      'automod',
    ] as ModAction[]) {
      const entry = f.add(action);
      for (const surface of ['reply', 'dm', 'announce']) {
        const body = caseEmbed(entry, f.ctx(), surface === 'dm');
        assert.equal(body.color, palette[action]);
        assert.equal(
          body.footer?.text,
          `Case #${entry.case_number} • Familiar`,
        );
        assert.equal(body.author?.name, 'Subject#1234');
        assert.ok(body.author?.icon_url);
        assert.ok(body.thumbnail?.url);
        assert.equal(body.timestamp, entry.created_at);
        assert.ok(
          body.fields?.some(
            (x) => x.name === 'Member' && x.value.includes('42'),
          ),
        );
        assert.ok(body.fields?.some((x) => x.name === 'Reason'));
        assert.equal(
          body.fields?.some((x) => x.name === 'Moderator'),
          surface !== 'dm',
        );
        if (surface === 'dm') assert.match(body.description!, /Test server/);
      }
    }
  } finally {
    f.close();
  }
});

test('persistent case buttons survive engine and database restart, reauthorize confirmation, audit and update all posts', async () => {
  const f = fixture();
  try {
    const entry = f.add();
    await sendCase(f.ctx(), entry, f.channel);
    await sendCase(f.ctx(), entry, f.channel);
    const original = f.posts.get('1');
    const id = original.components[0].components[0].custom_id;
    assert.ok(id.length <= 100);
    f.restart();
    f.deny();
    await f.click(id, original);
    assert.equal(f.replies.at(-1).ephemeral, true);
    assert.equal(f.ctx().store.modCase('10', 1).active, true);
    assert.equal(f.ctx().store.auditEntries().length, 0);
    f.allow();
    await f.click(id, original);
    const confirmation = f.replies.at(-1);
    const confirmId = confirmation.components[0].components[0].custom_id;
    f.restart();
    f.deny();
    await f.click(confirmId, confirmation);
    assert.equal(f.ctx().store.modCase('10', 1).active, true);
    f.allow();
    await f.click(confirmId, confirmation);
    assert.equal(f.ctx().store.modCase('10', 1).active, false);
    for (const post of f.posts.values()) {
      assert.deepEqual(post.components, []);
      assert.ok(
        post.embeds[0].fields.some(
          (x: any) => x.name === 'Status' && x.value === 'Voided by <@7>',
        ),
      );
    }
    assert.ok(
      f
        .ctx()
        .store.auditEntries()
        .some((x: any) => x.key === '7' && x.tool === 'component:confirm'),
    );
  } finally {
    f.close();
  }
});

test('history pages both directions and filters in place after restart; expired panels deny', async () => {
  const f = fixture();
  try {
    for (let n = 0; n < 12; n++) f.add(n % 2 ? 'warn' : 'ban');
    const id = createPanel(f.ctx(), {
      kind: 'history',
      user: '42',
      invoker: '7',
      expires: Date.now() + 900000,
    });
    const body = historyBody(f.ctx(), id, '42');
    assert.match(body.content, /12 cases · Page 1\/3/);
    f.restart();
    await f.click(
      body.components[0].components[2].custom_id,
      body,
      undefined,
      '8',
    );
    assert.match(body.content, /Page 2\/3/);
    await f.click(body.components[0].components[0].custom_id, body);
    assert.match(body.content, /Page 1\/3/);
    await f.click(body.components[1].components[0].custom_id, body, ['1']);
    assert.match(body.content, /6 cases · Page 1\/2/);
    assert.ok(body.embeds.every((x) => x.title?.includes('warn')));
    const expired = createPanel(f.ctx(), {
      kind: 'history',
      user: '42',
      expires: Date.now() - 1,
    });
    await f.click(`fam:mod:filter:${expired}`, body, ['0']);
    assert.match(f.replies.at(-1).content, /expired/);
  } finally {
    f.close();
  }
});

test('automod TTL notice and full log support authorized timeout with linked cases and spent buttons', async () => {
  const f = fixture();
  try {
    const store = f.ctx().store;
    store.saveModuleInstances([
      {
        botId: '1',
        guildId: '10',
        moduleId: 'automod',
        enabled: true,
        config: { noticeTtlSeconds: 0.01 },
      },
      {
        botId: '1',
        guildId: '10',
        moduleId: 'logging',
        enabled: true,
        config: { channelId: '50' },
      },
    ]);
    store.saveFeatureInstances([
      {
        botId: '1',
        guildId: '10',
        featureId: 'automod.word-filter',
        enabled: true,
        config: { words: ['bad'], action: 'warn' },
      },
      {
        botId: '1',
        guildId: '10',
        featureId: 'logging.memberModerated',
        enabled: true,
        config: {},
      },
    ]);
    await f.dispatch('messageCreate', {
      guild: f.guild,
      author: f.user,
      content: 'bad',
      channel: f.channel,
      channelId: '50',
      url: 'https://discord.com/channels/10/50/100',
    });
    assert.equal(store.modCases('10').length, 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(f.deleted(), 1);
    const log = f.posts.get('1');
    for (const name of [
      'Channel',
      'Rule / feature',
      'Matched term',
      'Action taken',
      'Message',
    ])
      assert.ok(log.embeds[0].fields.some((x: any) => x.name === name));
    const timeoutId = log.components[0].components[1].custom_id;
    f.deny();
    await f.click(timeoutId, log);
    assert.equal(f.timeouts(), 0);
    assert.equal(store.modCases('10').length, 1);
    assert.equal(f.replies.at(-1).ephemeral, true);
    f.allow();
    await f.click(timeoutId, log);
    const select = f.replies.at(-1);
    f.restart();
    f.deny();
    await f.click(select.components[0].components[0].custom_id, select, ['1']);
    assert.equal(f.timeouts(), 0);
    assert.equal(f.ctx().store.modCases('10').length, 1);
    f.allow();
    await f.click(select.components[0].components[0].custom_id, select, ['1']);
    assert.equal(f.timeouts(), 1);
    const cases = f.ctx().store.modCases('10');
    assert.equal(cases.length, 2);
    assert.equal(cases[0].actor, '7');
    assert.equal(cases[0].metadata.sourceCase, '1');
    assert.match(cases[1].metadata.timeoutCase, /#2/);
    assert.equal(log.components[0].components.length, 1);
    assert.ok(log.embeds[0].fields.some((x: any) => x.value.includes('#2')));
    await f.click(timeoutId, log);
    assert.equal(f.timeouts(), 1);
  } finally {
    f.close();
  }
});
