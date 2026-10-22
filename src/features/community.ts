import { z } from 'zod';
import type {
  Client,
  Message,
  MessageReaction,
  PartialMessageReaction,
  User,
  PartialUser,
} from 'discord.js';
import {
  snowflake,
  type Feature,
  type Module,
  type FeatureContext,
} from './types.js';

export const customCommand = z
  .object({
    name: z.string().min(1).max(100),
    match: z.enum(['command', 'exact']),
    response: z.string().min(1).max(2000),
    roles: z.array(snowflake).optional(),
    channels: z.array(snowflake).optional(),
    cooldownSeconds: z.number().int().min(0).max(86400).optional(),
    deleteInvocation: z.boolean().optional(),
  })
  .refine((c) => c.match !== 'command' || !/\s/.test(c.name), {
    message: 'Command names cannot contain whitespace.',
  });
export function emojiKey(emoji: string) {
  return emoji.match(/^<a?:[^:>]+:(\d+)>$/)?.[1] ?? emoji;
}
export const reactionBinding = z.object({
  channelId: snowflake,
  messageId: snowflake,
  emoji: z.string().trim().min(1).max(100),
  roleId: snowflake,
  mode: z.enum(['toggle', 'add_only']).default('toggle'),
});
export const communityModule: Module = {
  id: 'community',
  label: 'Community',
  description: 'Custom message commands and reaction roles.',
  configSchema: z.object({
    prefix: z.string().min(1).max(20).regex(/^\S+$/).default('!'),
  }),
  fields: {
    prefix: {
      type: 'text',
      label: 'Command prefix',
      help: 'Used by all custom commands in command mode. Default: !',
    },
  },
};
const commandsSchema = z.object({
  commands: z
    .array(customCommand)
    .default([])
    .refine(
      (rows) =>
        new Set(rows.map((r) => `${r.match}:${r.name}`)).size === rows.length,
      'Duplicate command trigger.',
    ),
});
const bindingsSchema = z.object({
  bindings: z
    .array(reactionBinding)
    .default([])
    .refine(
      (rows) =>
        new Set(
          rows.map((r) => `${r.channelId}:${r.messageId}:${emojiKey(r.emoji)}`),
        ).size === rows.length,
      'An emoji can map to only one role per message.',
    ),
});
const cooldowns = new WeakMap<Client, Map<string, number>>();
const messageIntents = ['GuildMessages', 'MessageContent'] as const;
async function command(ctx: FeatureContext, message: Message) {
  if (
    !message.guild ||
    message.author.bot ||
    message.author.id === ctx.client.user?.id
  )
    return;
  const { commands } = commandsSchema.parse(ctx.config);
  for (const entry of commands) {
    const trigger = `${ctx.config.prefix ?? '!'}${entry.name}`;
    const matches =
      entry.match === 'exact'
        ? message.content === entry.name
        : message.content === trigger ||
          (message.content.startsWith(trigger) &&
            /\s/.test(message.content[trigger.length]));
    if (
      !matches ||
      (entry.channels?.length && !entry.channels.includes(message.channelId))
    )
      continue;
    if (entry.roles?.length) {
      const member =
        message.member ?? (await ctx.guild.members.fetch(message.author.id));
      if (!entry.roles.some((id) => member.roles.cache.has(id))) continue;
    }
    let cache = cooldowns.get(ctx.client);
    if (!cache) cooldowns.set(ctx.client, (cache = new Map()));
    const now = Date.now();
    for (const [key, expiry] of cache) if (expiry <= now) cache.delete(key);
    const key = `${ctx.guild.id}:${entry.match}:${entry.name}:${message.author.id}`;
    if ((cache.get(key) ?? 0) > now || !ctx.active()) continue;
    cache.set(key, now + (entry.cooldownSeconds ?? 0) * 1000);
    const values: Record<string, string> = {
      user: `<@${message.author.id}>`,
      userName: message.author.username,
      server: ctx.guild.name,
      channel: `<#${message.channelId}>`,
      args:
        entry.match === 'command'
          ? message.content.slice(trigger.length).trim()
          : '',
    };
    const content = entry.response
      .replace(
        /\{(user|userName|server|channel|args)\}/g,
        (_, key: string) => values[key],
      )
      .slice(0, 2000);
    await message.reply({
      content,
      allowedMentions: { parse: [], repliedUser: false },
    });
    if (entry.deleteInvocation && ctx.active()) await message.delete();
  }
}
async function reaction(
  ctx: FeatureContext,
  incoming: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  remove: boolean,
) {
  const { bindings } = bindingsSchema.parse(ctx.config);
  const binding = bindings.find(
    (b) =>
      b.messageId === incoming.message.id &&
      b.channelId === incoming.message.channelId &&
      emojiKey(b.emoji) === (incoming.emoji.id ?? incoming.emoji.name),
  );
  if (
    !binding ||
    (remove && binding.mode === 'add_only') ||
    user.bot ||
    user.id === ctx.client.user?.id
  )
    return;
  try {
    if (user.partial) user = await user.fetch();
    if (user.bot) return;
    if (incoming.message.partial) await incoming.message.fetch();
    // A removed reaction may no longer exist remotely; its event already contains its emoji.
    if (incoming.partial && !remove) await incoming.fetch();
    const member = await ctx.guild.members.fetch(user.id);
    const role = await ctx.guild.roles.fetch(binding.roleId);
    const me = ctx.guild.members.me ?? (await ctx.guild.members.fetchMe());
    if (!role || role.managed || me.roles.highest.comparePositionTo(role) <= 0)
      throw new Error('Role hierarchy');
    if (!ctx.active()) return;
    if (remove) await member.roles.remove(binding.roleId);
    else await member.roles.add(binding.roleId);
  } catch {
    ctx.logger(
      `Reaction role ${remove ? 'removal' : 'assignment'} failed for message ${binding.messageId}, role ${binding.roleId}, user ${user.id}. Check role hierarchy and Manage Roles permission.`,
    );
  }
}
export const communityFeatures: Feature[] = [
  {
    id: 'community.customCommands',
    module: 'community',
    name: 'Custom commands',
    label: 'Custom commands',
    description: 'Respond to commands and exact message triggers.',
    configSchema: commandsSchema,
    fields: {
      commands: {
        type: 'commands',
        label: 'Commands',
        help: 'Placeholders: {user}, {userName}, {server}, {channel}, {args}. Empty restrictions allow everyone everywhere.',
      },
    },
    requiredIntents: [...messageIntents],
    events: [
      { name: 'messageCreate', intents: [...messageIntents], handle: command },
    ],
  },
  {
    id: 'community.reactionRoles',
    module: 'community',
    name: 'Reaction roles',
    label: 'Reaction roles',
    description: 'Grant roles from reactions on designated messages.',
    configSchema: bindingsSchema,
    fields: {
      bindings: {
        type: 'bindings',
        label: 'Bindings',
        help: 'Paste a message ID or Discord message link. The bot needs Manage Roles and a higher role.',
      },
    },
    requiredIntents: [...messageIntents, 'GuildMessageReactions'],
    events: ['messageReactionAdd', 'messageReactionRemove'].map((name) => ({
      name,
      intents: [...messageIntents, 'GuildMessageReactions'],
      handle: (ctx, r, u) =>
        reaction(ctx, r, u, name === 'messageReactionRemove'),
    })),
  },
];
