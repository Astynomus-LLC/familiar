/* eslint-disable @typescript-eslint/no-explicit-any -- Discord event tuples have different payload shapes; the registry is the dynamic dispatch boundary. */
import { z } from 'zod';
import { AuditLogEvent } from 'discord.js';
import type { Feature, FeatureContext } from './types.js';
import { snowflake } from './types.js';
const families = [
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
    (ctx.config.families as string[]).includes('memberModerated')
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
  if (!(ctx.config.families as string[]).includes(family)) return;
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
  await channel.send({
    embeds: [
      { title, fields, timestamp: new Date().toISOString(), color: 0x8b7cf8 },
    ],
    allowedMentions: { parse: [] },
  });
}
export const logging: Feature = {
  id: 'logging',
  name: 'Server logging',
  description: 'Log message, member, role, and channel changes.',
  configSchema: z.object({
    channelId: snowflake,
    families: z.array(z.enum(families)).default([...families]),
    ignoreBots: z.boolean().default(true),
    ignoredChannelIds: z.array(snowflake).default([]),
    includeContent: z.boolean().default(true),
  }),
  requiredIntents: [
    'Guilds',
    'GuildMessages',
    'GuildMembers',
    'GuildModeration',
    'MessageContent',
  ],
  events: definitions.map(([name, family, intent]) => ({
    name,
    intents: [intent],
    handle: (ctx, before, after) => log(ctx, name, family, before, after),
  })),
};
