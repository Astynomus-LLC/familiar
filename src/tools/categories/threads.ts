import { z } from 'zod';
import { channel, guild, id } from '../params.js';
import { restTool, type Category } from '../types.js';

export const threads: Category = {
  name: 'threads',
  description: 'Create, archive, and join threads',
  tools: [
    restTool({
      name: 'threads_list',
      description: 'List active guild threads.',
      method: 'GET',
      schema: guild,
      path: (a) => `/guilds/${a.guild_id}/threads/active`,
    }),
    restTool({
      name: 'threads_create',
      description: 'Create a thread in a text channel.',
      method: 'POST',
      schema: channel.extend({
        name: z.string().min(1).max(100),
        type: z.union([z.literal(11), z.literal(12)]).default(11),
        auto_archive_duration: z
          .union([
            z.literal(60),
            z.literal(1440),
            z.literal(4320),
            z.literal(10080),
          ])
          .default(1440),
      }),
      path: (a) => `/channels/${a.channel_id}/threads`,
      body: (a) => ({
        name: a.name,
        type: a.type,
        auto_archive_duration: a.auto_archive_duration,
      }),
    }),
    restTool({
      name: 'threads_archive',
      description: 'Archive or reopen a thread.',
      method: 'PATCH',
      schema: channel.extend({
        archived: z.boolean(),
        locked: z.boolean().optional(),
      }),
      path: (a) => `/channels/${a.channel_id}`,
      body: (a) => ({ archived: a.archived, locked: a.locked }),
    }),
    restTool({
      name: 'threads_join',
      description: 'Join a thread as the bot.',
      method: 'PUT',
      schema: channel,
      path: (a) => `/channels/${a.channel_id}/thread-members/@me`,
    }),
    restTool({
      name: 'threads_add_member',
      description: 'Add a member to a thread.',
      method: 'PUT',
      schema: channel.extend({ user_id: id }),
      path: (a) => `/channels/${a.channel_id}/thread-members/${a.user_id}`,
    }),
  ],
};
