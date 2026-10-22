import { z } from 'zod';
import { guild, id, member } from '../params.js';
const subject = member.extend({ reason: z.string().max(1000).optional() });
import { restTool, type Category } from '../types.js';
import { duration } from '../../features/moderation-service.js';
const actionSubject = guild.extend({
  member: id.describe('Subject member user ID'),
  reason: z.string().max(1000).describe('Reason recorded in the server modlog'),
});

export const moderation: Category = {
  name: 'moderation',
  description: 'Bans, kicks, warnings, timeouts, and pruning',
  tools: [
    restTool({
      name: 'ban_member',
      description: 'Ban a member. The reason is recorded in the server modlog.',
      method: 'PUT',
      schema: actionSubject.extend({
        delete_messages: z
          .number()
          .int()
          .min(0)
          .max(604800)
          .default(0)
          .describe('Seconds of message history to delete'),
      }),
      path: (a) => `/guilds/${a.guild_id}/bans/${a.member}`,
      body: (a) => ({ delete_message_seconds: a.delete_messages }),
      destructive: true,
    }),
    restTool({
      name: 'kick_member',
      description:
        'Kick a member. The reason is recorded in the server modlog.',
      method: 'DELETE',
      schema: actionSubject,
      path: (a) => `/guilds/${a.guild_id}/members/${a.member}`,
      destructive: true,
    }),
    restTool({
      name: 'timeout_member',
      description:
        'Timeout a member, or use null to clear it. The reason is recorded in the server modlog.',
      method: 'PATCH',
      schema: actionSubject.extend({
        duration: z
          .string()
          .refine((value) => {
            try {
              duration(value);
              return true;
            } catch {
              return false;
            }
          }, 'Duration must be 1s–28d, for example 30m or 1h.')
          .nullable(),
      }),
      path: (a) => `/guilds/${a.guild_id}/members/${a.member}`,
      body: (a) => ({
        communication_disabled_until:
          a.duration === null
            ? null
            : new Date(Date.now() + duration(String(a.duration))).toISOString(),
      }),
      destructive: true,
    }),
    {
      name: 'warn_member',
      description:
        'Warn a member. The reason is recorded in the server modlog. When moderation is enabled, notify the member and apply configured warn escalations.',
      schema: actionSubject,
      mutating: true,
      execute: ({ bot, manager, actorLabel }, a) =>
        manager.warnMember(
          bot,
          String(a.guild_id),
          String(a.member),
          String(a.reason),
          actorLabel,
        ),
    },
    restTool({
      name: 'moderation_bans',
      description: 'List guild bans.',
      method: 'GET',
      schema: guild,
      path: (a) => `/guilds/${a.guild_id}/bans`,
    }),
    restTool({
      name: 'moderation_ban',
      description: 'Ban a member. The reason is recorded in the server modlog.',
      method: 'PUT',
      schema: subject.extend({
        delete_message_seconds: z.number().int().min(0).max(604800).default(0),
      }),
      path: (a) => `/guilds/${a.guild_id}/bans/${a.user_id}`,
      body: (a) => ({ delete_message_seconds: a.delete_message_seconds }),
      destructive: true,
    }),
    restTool({
      name: 'moderation_unban',
      description: 'Remove a ban. The reason is recorded in the server modlog.',
      method: 'DELETE',
      schema: subject,
      path: (a) => `/guilds/${a.guild_id}/bans/${a.user_id}`,
      destructive: true,
    }),
    restTool({
      name: 'moderation_kick',
      description:
        'Kick a member. The reason is recorded in the server modlog.',
      method: 'DELETE',
      schema: subject,
      path: (a) => `/guilds/${a.guild_id}/members/${a.user_id}`,
      destructive: true,
    }),
    restTool({
      name: 'moderation_timeout',
      description:
        'Set a member timeout, or null to clear it. The reason is recorded in the server modlog.',
      method: 'PATCH',
      schema: subject.extend({ until: z.iso.datetime().nullable() }),
      path: (a) => `/guilds/${a.guild_id}/members/${a.user_id}`,
      body: (a) => ({ communication_disabled_until: a.until }),
      destructive: true,
    }),
    restTool({
      name: 'moderation_prune_count',
      description: 'Preview the number of inactive members to prune.',
      method: 'GET',
      schema: guild.extend({
        days: z.number().int().min(1).max(30).default(7),
      }),
      path: (a) => `/guilds/${a.guild_id}/prune?days=${a.days}`,
    }),
    restTool({
      name: 'moderation_prune',
      description: 'Prune inactive guild members.',
      method: 'POST',
      schema: guild.extend({
        days: z.number().int().min(1).max(30).default(7),
      }),
      path: (a) => `/guilds/${a.guild_id}/prune`,
      body: (a) => ({ days: a.days }),
      destructive: true,
    }),
  ],
};
