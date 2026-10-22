import {
  PermissionFlagsBits as P,
  Routes,
  type GuildChannel,
  type TextChannel,
} from 'discord.js';
import type { FeatureContext } from './types.js';
import { publishModeration, recordCase } from './moderation-service.js';

export type ChannelAction = 'purge' | 'lock' | 'unlock' | 'slowmode';
import { channelPermissions } from './channel-permissions.js';
interface Options {
  count?: number;
  member?: string;
  reason?: string;
  seconds?: number;
}
interface Snapshot {
  overwrite: { allow: string; deny: string; type: number } | null;
}
const busy = new WeakMap<object, Set<string>>();

export async function moderateChannel(
  ctx: FeatureContext,
  channel: GuildChannel,
  action: ChannelAction,
  actor: string,
  options: Options = {},
  invoker?: string,
) {
  if (!ctx.store || !ctx.bot) throw new Error('Moderation store unavailable.');
  if (channel.guild.id !== ctx.guild.id)
    throw new Error('Select a channel in this server.');
  const me = ctx.guild.members.me ?? (await ctx.guild.members.fetchMe());
  const required = channelPermissions[action];
  if (
    !channel.permissionsFor(me)?.has(required) ||
    (invoker &&
      !channel
        .permissionsFor(await ctx.guild.members.fetch(invoker))
        ?.has(required))
  )
    throw new Error(
      'Missing the required moderation permission in this channel.',
    );
  if (
    action === 'purge' &&
    !channel.permissionsFor(me)?.has([P.ViewChannel, P.ReadMessageHistory])
  )
    throw new Error('The bot needs View Channel and Read Message History.');
  // Discord requires Manage Roles to edit permission overwrites.
  if (
    (action === 'lock' || action === 'unlock') &&
    !channel.permissionsFor(me)?.has(P.ManageRoles)
  )
    throw new Error('The bot needs Manage Roles to edit channel overwrites.');
  if (!ctx.active()) throw new Error('Moderation is disabled.');
  const key = `moderationLock:${ctx.bot.id}:${ctx.guild.id}:${channel.id}`;
  const running = busy.get(ctx.store) ?? new Set<string>();
  busy.set(ctx.store, running);
  if (running.has(key))
    throw new Error('A moderation action is already running in this channel.');
  running.add(key);
  try {
    const reason = options.reason ?? 'Channel moderation';
    let message: string;
    let deleted = 0;
    if (action === 'purge') {
      const count = options.count!;
      if (!Number.isInteger(count) || count < 1 || count > 500)
        throw new Error('Count must be 1–500.');
      if (!('bulkDelete' in channel))
        throw new Error('This channel does not support bulk deletion.');
      const text = channel as TextChannel;
      let before: string | undefined;
      let scanned = 0;
      try {
        while (scanned < count) {
          const page = await text.messages.fetch({
            limit: Math.min(100, count - scanned),
            before,
            cache: false,
          });
          if (!page.size) break;
          scanned += page.size;
          before = page.last()!.id;
          const recent = page.filter(
            (m) => m.createdTimestamp > Date.now() - 14 * 86400000,
          );
          const selected = recent.filter(
            (m) => !options.member || m.author.id === options.member,
          );
          if (selected.size)
            deleted += (await text.bulkDelete(selected, true)).size;
          if (recent.size !== page.size) break;
        }
      } catch (error) {
        if (!deleted) throw error;
        await finish(
          `Deleted ${deleted} messages before Discord rejected the remaining request.`,
          deleted,
        );
        return {
          message: `Deleted ${deleted} messages; the remaining request failed.`,
          deleted,
        };
      }
      message = `Deleted ${deleted} messages.`;
    } else if (action === 'slowmode') {
      const seconds = options.seconds!;
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600)
        throw new Error('Seconds must be 0–21600.');
      if (!('setRateLimitPerUser' in channel))
        throw new Error('This channel does not support slowmode.');
      await (channel as TextChannel).setRateLimitPerUser(seconds, reason);
      const human = [
        Math.floor(seconds / 3600) && `${Math.floor(seconds / 3600)}h`,
        Math.floor((seconds % 3600) / 60) &&
          `${Math.floor((seconds % 3600) / 60)}m`,
        seconds % 60 && `${seconds % 60}s`,
      ]
        .filter(Boolean)
        .join(' ');
      message = seconds ? `Slowmode set to ${human}.` : 'Slowmode off.';
    } else {
      const snapshot = ctx.store.setting<Snapshot | null>(key);
      if (action === 'lock') {
        if (snapshot)
          return { message: 'This channel is already locked by Familiar.' };
        const overwrite = channel.permissionOverwrites.cache.get(ctx.guild.id);
        if (overwrite?.deny.has(P.SendMessages))
          return { message: 'This channel is already locked.' };
        const prior: Snapshot = {
          overwrite: overwrite
            ? {
                allow: overwrite.allow.bitfield.toString(),
                deny: overwrite.deny.bitfield.toString(),
                type: overwrite.type,
              }
            : null,
        };
        ctx.store.setSetting(key, prior);
        try {
          await ctx.client.rest.put(
            Routes.channelPermission(channel.id, ctx.guild.id),
            {
              body: {
                type: 0,
                allow: (
                  (overwrite?.allow.bitfield ?? 0n) & ~P.SendMessages
                ).toString(),
                deny: (
                  (overwrite?.deny.bitfield ?? 0n) | P.SendMessages
                ).toString(),
              },
              reason,
            },
          );
        } catch (error) {
          // A definite Discord rejection did not change the overwrite. Retain
          // the snapshot on ambiguous network failures so unlock can recover it.
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            typeof error.code === 'number'
          )
            ctx.store.setSetting(key, null);
          throw error;
        }
        message = 'Channel locked.';
      } else {
        if (!snapshot)
          throw new Error(
            'Familiar did not lock this channel; there is no saved overwrite to restore.',
          );
        if (snapshot.overwrite)
          await ctx.client.rest.put(
            Routes.channelPermission(channel.id, ctx.guild.id),
            { body: snapshot.overwrite, reason },
          );
        else await channel.permissionOverwrites.delete(ctx.guild.id, reason);
        ctx.store.setSetting(key, null);
        message = 'Channel unlocked.';
      }
    }
    await finish(message, deleted);
    return { message, ...(action === 'purge' ? { deleted } : {}) };

    async function finish(result: string, count: number) {
      const metadata = { channel: `<#${channel.id}>`, deleted: String(count) };
      const entry =
        action === 'purge' && options.member
          ? recordCase(ctx, {
              user_id: options.member,
              actor,
              action: 'purge',
              reason,
              metadata,
            })
          : null;
      if (!entry)
        ctx.store!.audit({
          timestamp: new Date().toISOString(),
          key: actor,
          bot: ctx.bot!,
          tool: action,
          target: `${ctx.guild.id}:${channel.id}`,
          result,
        });
      await publishModeration(
        ctx,
        entry
          ? { ...entry }
          : {
              action,
              actor,
              reason,
              channel: `<#${channel.id}>`,
              metadata,
              result,
            },
      );
    }
  } finally {
    running.delete(key);
  }
}
