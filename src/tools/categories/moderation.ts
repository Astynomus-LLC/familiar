import { z } from 'zod';
import { guild, member } from '../params.js';
import { restTool, type Category } from '../types.js';

export const moderation: Category = {
  name: 'moderation',
  description: 'Bans, kicks, timeouts, and pruning',
  tools: [
    restTool({
      name: 'moderation_bans',
      description: 'List guild bans.',
      method: 'GET',
      schema: guild,
      path: (a) => `/guilds/${a.guild_id}/bans`,
    }),
    restTool({
      name: 'moderation_ban',
      description: 'Ban a member.',
      method: 'PUT',
      schema: member.extend({
        delete_message_seconds: z.number().int().min(0).max(604800).default(0),
      }),
      path: (a) => `/guilds/${a.guild_id}/bans/${a.user_id}`,
      body: (a) => ({ delete_message_seconds: a.delete_message_seconds }),
      destructive: true,
    }),
    restTool({
      name: 'moderation_unban',
      description: 'Remove a ban.',
      method: 'DELETE',
      schema: member,
      path: (a) => `/guilds/${a.guild_id}/bans/${a.user_id}`,
      destructive: true,
    }),
    restTool({
      name: 'moderation_kick',
      description: 'Kick a member.',
      method: 'DELETE',
      schema: member,
      path: (a) => `/guilds/${a.guild_id}/members/${a.user_id}`,
      destructive: true,
    }),
    restTool({
      name: 'moderation_timeout',
      description: 'Set a member timeout, or null to clear it.',
      method: 'PATCH',
      schema: member.extend({ until: z.iso.datetime().nullable() }),
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
