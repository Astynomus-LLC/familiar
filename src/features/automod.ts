/* eslint-disable @typescript-eslint/no-explicit-any -- Discord event payload boundary. */
import { noticeEmbed } from './presentation.js';
import { escalate, moderationModule } from './moderation.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PermissionFlagsBits } from 'discord.js';
import {
  snowflake,
  type ConfigField,
  type Feature,
  type FeatureContext,
  type Module,
} from './types.js';
import { publishModeration, recordCase } from './moderation-service.js';
const actions = [
  'delete',
  'warn',
  'delete_and_warn',
  'timeout',
  'kick',
] as const;
const action = z.enum(actions);
const select = (label: string, values: readonly string[]): ConfigField => ({
  type: 'select',
  label,
  help: `Choose the ${label.toLowerCase()} for this server.`,
  options: values.map((value) => ({
    value,
    label: value.replaceAll('_', ' '),
  })),
});
const field = (
  type: ConfigField['type'],
  label: string,
  help = `Configure ${label.toLowerCase()} for this server.`,
): ConfigField => ({ type, label, help });
export const automodModule: Module = {
  id: 'automod',
  label: 'Auto Moderation',
  description: 'Filter messages using server-specific rules.',
  configSchema: z.object({
    exemptRoles: z.array(snowflake).default([]),
    exemptChannels: z.array(snowflake).default([]),
    ignoreBots: z.boolean().default(true),
    defaultAction: action.default('delete'),
    noticeTtlSeconds: z.number().min(0.01).max(300).default(8),
    timeoutSeconds: z.number().int().min(1).max(2419200).default(3600),
  }),
  fields: {
    noticeTtlSeconds: field(
      'number',
      'Notice lifetime (seconds)',
      'Delete in-channel notices after this many seconds (default 8).',
    ),
    exemptRoles: field('roles', 'Exempt roles'),
    exemptChannels: field('channels', 'Exempt channels'),
    ignoreBots: field('toggle', 'Ignore other bots'),
    defaultAction: select('Default action', actions),
    timeoutSeconds: field('number', 'Default timeout seconds'),
  },
};
const repeats = new WeakMap<
  object,
  Map<string, { hash: string; times: number[] }>
>();
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/)
  .max(253);
const rules: {
  id: string;
  label: string;
  schema: z.ZodRawShape;
  fields: Record<string, ConfigField>;
  match: (ctx: FeatureContext, m: any, c: any) => string | undefined;
}[] = [
  {
    id: 'word-filter',
    label: 'Word filter',
    schema: {
      words: z.array(z.string().trim().min(1).max(200)).max(1000).default([]),
      matchMode: z.enum(['whole_word', 'substring']).default('whole_word'),
    },
    fields: {
      words: field('list', 'Words and phrases', 'One word or phrase per line.'),
      matchMode: select('Match mode', ['whole_word', 'substring']),
    },
    match: (_ctx, m, c) =>
      c.words.find((word: string) =>
        c.matchMode === 'substring'
          ? m.content.toLowerCase().includes(word.toLowerCase())
          : new RegExp(
              `(?:^|[^\\p{L}\\p{N}_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}_])`,
              'iu',
            ).test(m.content),
      ),
  },
  {
    id: 'link-filter',
    label: 'Link filter',
    schema: {
      mode: z
        .enum(['block_all', 'block_except_allowlist', 'blocklist_only'])
        .default('block_all'),
      allowlist: z.array(domain).default([]),
      blocklist: z.array(domain).default([]),
      block_invites: z.boolean().default(true),
    },
    fields: {
      mode: select('Mode', [
        'block_all',
        'block_except_allowlist',
        'blocklist_only',
      ]),
      allowlist: field(
        'list',
        'Allowed domains',
        'One domain per line; subdomains are included.',
      ),
      blocklist: field(
        'list',
        'Blocked domains',
        'One domain per line; subdomains are included.',
      ),
      block_invites: field('toggle', 'Block Discord invites'),
    },
    match: (_ctx, m, c) => {
      const urls =
        m.content.match(
          /(?:https?:\/\/|www\.)[^\s<>]+|(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s<>]+/gi,
        ) ?? [];
      for (const raw of urls) {
        try {
          const url = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
          const host = url.hostname.toLowerCase().replace(/\.$/, '');
          const inList = (list: string[]) =>
            list.some((d) => host === d || host.endsWith(`.${d}`));
          if (
            c.block_invites &&
            (host === 'discord.gg' ||
              host.endsWith('.discord.gg') ||
              (['discord.com', 'discordapp.com'].some(
                (d) => host === d || host.endsWith(`.${d}`),
              ) &&
                /^\/invite\//i.test(url.pathname)))
          )
            return 'discord-invite';
          if (
            c.mode === 'block_all' ||
            (c.mode === 'block_except_allowlist' && !inList(c.allowlist)) ||
            (c.mode === 'blocklist_only' && inList(c.blocklist))
          )
            return 'blocked-domain';
        } catch {
          /* Ignore malformed URLs. */
        }
      }
      return undefined;
    },
  },
  {
    id: 'attachment-filter',
    label: 'Attachment filter',
    schema: {
      blockImages: z.boolean().default(true),
      blockAllAttachments: z.boolean().default(false),
    },
    fields: {
      blockImages: field('toggle', 'Block images'),
      blockAllAttachments: field('toggle', 'Block all attachments'),
    },
    match: (_ctx, m, c) =>
      [...(m.attachments?.values() ?? [])].some(
        (a) =>
          c.blockAllAttachments ||
          (c.blockImages &&
            (a.contentType?.startsWith('image/') ||
              /\.(png|jpe?g|gif|webp|avif|svg|bmp)(?:$|\?)/i.test(
                a.name ?? '',
              ))),
      )
        ? 'attachment'
        : undefined,
  },
  {
    id: 'mention-limit',
    label: 'Mention limit',
    schema: {
      maxUserMentions: z.number().int().min(0).default(5),
      maxRoleMentions: z.number().int().min(0).default(2),
    },
    fields: {
      maxUserMentions: field('number', 'Maximum user mentions'),
      maxRoleMentions: field('number', 'Maximum role mentions'),
    },
    match: (_ctx, m, c) =>
      (m.mentions?.users.size ?? 0) > c.maxUserMentions ||
      (m.mentions?.roles.size ?? 0) > c.maxRoleMentions
        ? 'mention-limit'
        : undefined,
  },
  {
    id: 'caps-filter',
    label: 'Caps filter',
    schema: {
      minLength: z.number().int().min(1).default(10),
      maxCapsPercentage: z.number().min(0).max(100).default(70),
    },
    fields: {
      minLength: field('number', 'Minimum message length'),
      maxCapsPercentage: field('number', 'Maximum caps percentage'),
    },
    match: (_ctx, m, c) => {
      const letters = m.content.match(/\p{L}/gu) ?? [];
      return m.content.length >= c.minLength &&
        letters.length &&
        ((m.content.match(/\p{Lu}/gu)?.length ?? 0) / letters.length) * 100 >
          c.maxCapsPercentage
        ? 'caps-percentage'
        : undefined;
    },
  },
  {
    id: 'repeat-filter',
    label: 'Repeat filter',
    schema: {
      repeatCount: z.number().int().min(2).max(100).default(3),
      windowSeconds: z.number().int().min(1).max(3600).default(10),
    },
    fields: {
      repeatCount: field('number', 'Repeat count'),
      windowSeconds: field('number', 'Window seconds'),
    },
    match: (ctx, m, c) => {
      let cache = repeats.get(ctx.client);
      if (!cache) {
        cache = new Map();
        repeats.set(ctx.client, cache);
      }
      const now = Date.now();
      for (const [key, entry] of cache)
        if (now - entry.times.at(-1)! > 3600000) cache.delete(key);
      const hash = createHash('sha256').update(m.content).digest('hex');
      const key = `${ctx.guild.id}:${m.channelId}:${m.author.id}:${hash}`;
      const old = cache.get(key);
      const times =
        old?.hash === hash
          ? old.times.filter((t) => now - t <= c.windowSeconds * 1000)
          : [];
      times.push(now);
      cache.set(key, { hash, times: times.slice(-c.repeatCount) });
      if (cache.size > 10000) cache.delete(cache.keys().next().value!);
      return times.length >= c.repeatCount ? 'repeated-message' : undefined;
    },
  },
];
export const automodFeatures: Feature[] = rules.map((rule) => ({
  id: `automod.${rule.id}`,
  module: 'automod',
  name: rule.label,
  label: rule.label,
  description: `Apply the ${rule.label.toLowerCase()} to new messages.`,
  requiredIntents: ['GuildMessages', 'MessageContent'],
  configSchema: z.object({
    ...rule.schema,
    action: z.enum(['inherit', ...actions]).default('inherit'),
    durationSeconds: z
      .number()
      .int()
      .min(1)
      .max(2419200)
      .nullable()
      .default(null),
  }),
  fields: {
    ...rule.fields,
    action: select('Action', ['inherit', ...actions]),
    durationSeconds: field(
      'number',
      'Timeout seconds',
      'Leave blank to use the module default.',
    ),
  },
  events: [
    {
      name: 'messageCreate',
      intents: ['GuildMessages', 'MessageContent'],
      async handle(ctx, m) {
        const c: any = {
          ...automodModule.configSchema.parse(ctx.config),
          ...z.object(rule.schema).parse(ctx.config),
          ...ctx.config,
        };
        c.timeoutSeconds = c.durationSeconds ?? c.timeoutSeconds;
        if (
          m.author.id === ctx.client.user?.id ||
          (c.ignoreBots && m.author.bot) ||
          c.exemptChannels.includes(m.channelId)
        )
          return;
        const member = m.member ?? (await ctx.guild.members.fetch(m.author.id));
        if (c.exemptRoles.some((id: string) => member.roles.cache.has(id)))
          return;
        const match = rule.match(ctx, m, c);
        if (!match || !ctx.active()) return;
        try {
          const me =
            ctx.guild.members.me ?? (await ctx.guild.members.fetchMe());
          if (
            member.id === ctx.guild.ownerId ||
            me.roles.highest.comparePositionTo(member.roles.highest) <= 0
          )
            throw new Error('Role hierarchy prevents moderation.');
          const chosen =
            c.action && c.action !== 'inherit' ? c.action : c.defaultAction;
          if (
            (chosen === 'delete' || chosen === 'delete_and_warn') &&
            !m.channel
              .permissionsFor(me)
              ?.has(PermissionFlagsBits.ManageMessages)
          )
            throw new Error('Missing Manage Messages.');
          if (chosen === 'timeout' && !member.moderatable)
            throw new Error('Cannot timeout member.');
          if (chosen === 'kick' && !member.kickable)
            throw new Error('Cannot kick member.');
          if (
            (chosen === 'warn' || chosen === 'delete_and_warn') &&
            !me.permissions.has(PermissionFlagsBits.ModerateMembers)
          )
            throw new Error('Missing Moderate Members.');
          if (chosen === 'delete' || chosen === 'delete_and_warn')
            await m.delete();
          const reason = `Auto moderation: ${rule.id}`;
          if (chosen === 'timeout')
            await member.timeout(c.timeoutSeconds * 1000, reason);
          if (chosen === 'kick') await member.kick(reason);
          const event = {
            user_id: m.author.id,
            actor: `automod:${rule.id}`,
            action: chosen === 'delete_and_warn' ? 'warn' : chosen,
            reason,
            channel: `<#${m.channelId}>`,
            feature: rule.id,
            matched: match,
            jump: m.url ?? '',
          };
          if (chosen !== 'delete') {
            const entry = recordCase(ctx, {
              ...event,
              action:
                chosen === 'timeout'
                  ? 'timeout'
                  : chosen === 'kick'
                    ? 'kick'
                    : 'warn',
              expires_at:
                chosen === 'timeout'
                  ? new Date(Date.now() + c.timeoutSeconds * 1000).toISOString()
                  : null,
              metadata: {
                feature: rule.id,
                matched: match,
                channel: `<#${m.channelId}>`,
                jump: m.url ?? '',
                outcome: chosen,
              },
            });
            const warnCount =
              entry.action === 'warn'
                ? ctx.store!.activeWarnCount(ctx.guild.id, member.id)
                : 0;
            await publishModeration(ctx, { ...entry });
            const moderation = ctx.store!.moduleInstance(
              ctx.bot!.id,
              ctx.guild.id,
              'moderation',
            );
            if (warnCount && moderation.enabled)
              await escalate(
                ctx,
                member,
                moderationModule.configSchema.parse(moderation.config),
                warnCount,
              );
          } else {
            ctx.logger('success: delete');
            await publishModeration(ctx, event);
          }
          try {
            const notice = await m.channel.send({
              embeds: [noticeEmbed(rule.id, chosen)],
              allowedMentions: { parse: [] },
            });
            const timer = setTimeout(() => {
              void notice.delete().catch(() => {});
            }, c.noticeTtlSeconds * 1000);
            timer.unref();
          } catch {
            ctx.logger('Auto moderation notice delivery failed.');
          }
        } catch {
          ctx.logger(
            'Auto moderation failed. Check role hierarchy and Discord permissions; no case recorded.',
          );
        }
      },
    },
  ],
}));
