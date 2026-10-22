import { z } from 'zod';
import { channel, guild, id } from '../params.js';
import { restTool, type Category } from '../types.js';

export const channels: Category = {
  name: 'channels',
  description: 'Guild channels and permission overwrites',
  tools: [
    restTool({
      name: 'channels_list',
      description: 'List guild channels.',
      method: 'GET',
      schema: guild,
      path: (a) => `/guilds/${a.guild_id}/channels`,
    }),
    restTool({
      name: 'channels_get',
      description: 'Get a channel.',
      method: 'GET',
      schema: channel,
      path: (a) => `/channels/${a.channel_id}`,
    }),
    restTool({
      name: 'channels_create',
      description: 'Create a guild channel.',
      method: 'POST',
      schema: guild.extend({
        name: z.string().min(1).max(100),
        type: z.number().int(),
        parent_id: id.optional(),
      }),
      path: (a) => `/guilds/${a.guild_id}/channels`,
      body: (a) => ({ name: a.name, type: a.type, parent_id: a.parent_id }),
    }),
    restTool({
      name: 'channels_edit',
      description: 'Update channel name or topic.',
      method: 'PATCH',
      schema: channel.extend({
        name: z.string().min(1).max(100).optional(),
        topic: z.string().max(4096).optional(),
      }),
      path: (a) => `/channels/${a.channel_id}`,
      body: (a) => ({ name: a.name, topic: a.topic }),
    }),
    restTool({
      name: 'channels_delete',
      description: 'Delete a channel.',
      method: 'DELETE',
      schema: channel,
      path: (a) => `/channels/${a.channel_id}`,
      destructive: true,
    }),
    restTool({
      name: 'channels_permissions',
      description: 'Set a role or member permission overwrite.',
      method: 'PUT',
      schema: channel.extend({
        overwrite_id: id,
        type: z.enum(['role', 'member']),
        allow: z.string().regex(/^\d+$/),
        deny: z.string().regex(/^\d+$/),
      }),
      path: (a) => `/channels/${a.channel_id}/permissions/${a.overwrite_id}`,
      body: (a) => ({
        type: a.type === 'role' ? 0 : 1,
        allow: a.allow,
        deny: a.deny,
      }),
    }),
  ],
};
