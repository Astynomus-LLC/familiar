/* eslint-disable @typescript-eslint/no-explicit-any -- Discord event tuples have different payload shapes; the registry is the dynamic dispatch boundary. */
import { z } from 'zod';
import { AuditLogEvent } from 'discord.js';
import type { Feature, FeatureContext, Module } from './types.js';
import { snowflake } from './types.js';
export const loggingFamilies = [
  'messageEdited',
  'messageDeleted',
  'memberJoined',
  'memberLeft',
  'memberModerated',
  'roles',
  'channels',
] as const;
const definitions = [
  ['messageUpdate', 'messageEdited', 'GuildMessages'],
  ['messageDelete', 'messageDeleted', 'GuildMessages'],
  ['guildMemberAdd', 'memberJoined', 'GuildMembers'],
  ['guildMemberRemove', 'memberLeft', 'GuildMembers'],
  ['guildBanAdd', 'memberModerated', 'GuildModeration'],
  ['guildBanRemove', 'memberModerated', 'GuildModeration'],
  ['roleCreate', 'roles', 'Guilds'],
  ['roleUpdate', 'roles', 'Guilds'],
  ['roleDelete', 'roles', 'Guilds'],
  ['channelCreate', 'channels', 'Guilds'],
  ['channelUpdate', 'channels', 'Guilds'],
  ['channelDelete', 'channels', 'Guilds'],
] as const;
const clip = (value: unknown) =>
  String(value ?? 'unavailable').slice(0, 1000) || '(empty)';
async function log(
  ctx: FeatureContext,
  event: string,
  family: string,
  activeFamily: string,
  before: any,
  after?: any,
) {
  const item = after ?? before;
  const channelId =
    item.channelId ?? (event.startsWith('channel') ? item.id : undefined);
  if (
    channelId === ctx.config.channelId ||
    (ctx.config.ignoredChannelIds as string[]).includes(channelId)
  )
    return;
  const user = item.author ?? item.user;
  if (ctx.config.ignoreBots && user?.bot && user.id !== ctx.client.user?.id)
    return;
  let actor =
    event === 'messageUpdate' || event === 'guildMemberAdd'
      ? (user?.id ?? 'unavailable')
      : 'unavailable';
  let title = event;
  if (
    event === 'guildMemberRemove' &&
    ctx.enabledFeatures.includes('logging.memberModerated')
  ) {
    try {
      const logs = await ctx.guild.fetchAuditLogs({ limit: 5 });
      const entry = logs.entries.find(
        (e) =>
          e.targetId === item.id &&
          [AuditLogEvent.MemberKick, AuditLogEvent.MemberBanAdd].includes(
            e.action,
          ) &&
          Date.now() - e.createdTimestamp < 15000,
      );
      if (entry) {
        actor = entry.executorId ?? actor;
        title =
          entry.action === AuditLogEvent.MemberKick
            ? 'Member kicked'
            : 'Member banned';
        family = 'memberModerated';
      }
    } catch {
      /* Audit permissions are optional; retain the departure event. */
    }
  }
  if (family !== activeFamily) return;
  const auditTypes: Record<string, AuditLogEvent> = {
    guildBanAdd: AuditLogEvent.MemberBanAdd,
    guildBanRemove: AuditLogEvent.MemberBanRemove,
    roleCreate: AuditLogEvent.RoleCreate,
    roleUpdate: AuditLogEvent.RoleUpdate,
    roleDelete: AuditLogEvent.RoleDelete,
    channelCreate: AuditLogEvent.ChannelCreate,
    channelUpdate: AuditLogEvent.ChannelUpdate,
    channelDelete: AuditLogEvent.ChannelDelete,
  };
  if (auditTypes[event] !== undefined) {
    try {
      const logs = await ctx.guild.fetchAuditLogs({
        type: auditTypes[event],
        limit: 5,
      });
      const entry = logs.entries.find(
        (e) =>
          e.targetId === (user?.id ?? item.id) &&
          Date.now() - e.createdTimestamp < 15000,
      );
      actor = entry?.executorId ?? actor;
    } catch {
      /* Missing audit permission does not suppress the gateway event. */
    }
  }

  const fields = [
    { name: 'Actor', value: clip(actor) },
    {
      name: 'Target',
      value: clip(
        user
          ? `${user.tag ?? user.username ?? 'unknown'} (${user.id})`
          : item.name
            ? `${item.name} (${item.id})`
            : item.id,
      ),
    },
    { name: 'Channel', value: clip(channelId) },
  ];
  if (event.startsWith('message') && ctx.config.includeContent) {
    fields.push({
      name: after ? 'Before' : 'Content',
      value: clip(
        before.partial || !ctx.intents.includes('MessageContent')
          ? undefined
          : before.content,
      ),
    });
    if (after)
      fields.push({
        name: 'After',
        value: clip(
          before.partial ||
            after.partial ||
            !ctx.intents.includes('MessageContent')
            ? undefined
            : after.content,
        ),
      });
  }
  if (after && (event === 'roleUpdate' || event === 'channelUpdate')) {
    const describe = (v: any) =>
      JSON.stringify({
        name: v.name,
        color: v.color,
        permissions: v.permissions?.bitfield?.toString(),
        topic: v.topic,
        position: v.position,
      });
    fields.push(
      { name: 'Before', value: clip(describe(before)) },
      { name: 'After', value: clip(describe(after)) },
    );
  }
  const channel = await ctx.guild.channels.fetch(String(ctx.config.channelId));
  if (!channel?.isTextBased() || !('send' in channel))
    throw new Error('Log channel unavailable');
  if (!ctx.active()) return;
  await channel.send({
    embeds: [
      { title, fields, timestamp: new Date().toISOString(), color: 0x8b7cf8 },
    ],
    allowedMentions: { parse: [] },
  });
}
export const loggingModule: Module = {
  id: 'logging',
  label: 'Logging',
  description: 'Log message, member, role, and channel changes.',
  configSchema: z.object({
    channelId: snowflake,
    ignoreBots: z.boolean().default(true),
    ignoredChannelIds: z.array(snowflake).default([]),
    includeContent: z.boolean().default(true),
  }),
  fields: {
    channelId: {
      type: 'channel',
      label: 'Log channel',
      help: 'Send server activity to this channel.',
    },
    ignoreBots: {
      type: 'toggle',
      label: 'Ignore bots',
      help: 'Exclude activity from other bots.',
    },
    ignoredChannelIds: {
      type: 'channels',
      label: 'Ignored channels',
      help: 'Add channels to exclude from logging. Only the selected channels are ignored.',
    },
    includeContent: {
      type: 'toggle',
      label: 'Include message content',
      help: 'Requires the Message Content intent and cached messages.',
    },
  },
};
const labels = [
  'Message edits',
  'Message deletes',
  'Member joins',
  'Member leaves',
  'Member moderation',
  'Role changes',
  'Channel changes',
];
export const loggingFeatures: Feature[] = loggingFamilies.map(
  (family, index) => ({
    id: `logging.${family}`,
    module: 'logging',
    name: labels[index],
    label: labels[index],
    description: [
      'Record edited messages.',
      'Record deleted messages.',
      'Record new members.',
      'Record member departures.',
      'Record kicks and bans.',
      'Record role updates.',
      'Record channel updates.',
    ][index],
    configSchema: z.object({}),
    fields: {},
    requiredIntents:
      family === 'memberModerated'
        ? ['GuildMembers', 'GuildModeration']
        : [
            ...new Set(
              definitions.filter((d) => d[1] === family).map((d) => d[2]),
            ),
          ],
    events: [
      ...definitions.filter((d) => d[1] === family),
      ...(family === 'memberModerated'
        ? [['guildMemberRemove', 'memberModerated', 'GuildMembers'] as const]
        : []),
    ].map(([name, , intent]) => ({
      name,
      intents: [intent],
      handle: (ctx, before, after) =>
        log(
          ctx,
          name,
          name === 'guildMemberRemove' ? 'memberLeft' : family,
          family,
          before,
          after,
        ),
    })),
  }),
);

// Shared moderation hook: automod and human/agent actions use this destination.
export async function logModeration(
  ctx: FeatureContext,
  event: Record<string, unknown>,
) {
  if (!ctx.store || !ctx.bot) return;
  const module = ctx.store.moduleInstance(ctx.bot.id, ctx.guild.id, 'logging');
  if (
    !module.enabled ||
    !ctx.store
      .featureInstances(ctx.bot.id, ctx.guild.id)
      .some((i) => i.featureId === 'logging.memberModerated' && i.enabled)
  )
    return;
  const channel = await ctx.guild.channels.fetch(
    String(module.config.channelId),
  );
  if (!channel?.isTextBased() || !('send' in channel))
    throw new Error('Log channel unavailable');
  await channel.send({
    embeds: [
      {
        title: `Moderation · ${String(event.action)}`,
        fields: Object.entries(event)
          .filter(([key]) =>
            ['case_number', 'user_id', 'actor', 'reason'].includes(key),
          )
          .map(([name, value]) => ({ name, value: clip(value) })),
        timestamp: new Date().toISOString(),
      },
    ],
    allowedMentions: { parse: [] },
  });
}
