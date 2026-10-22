import { z } from 'zod';
import { channel, guild } from '../params.js';
import { restTool, type Category } from '../types.js';

export const invites: Category = {
  name: 'invites',
  description: 'Create, inspect, and revoke invites',
  tools: [
    restTool({
      name: 'invites_list',
      description: 'List guild invites.',
      method: 'GET',
      schema: guild,
      path: (a) => `/guilds/${a.guild_id}/invites`,
    }),
    restTool({
      name: 'invites_get',
      description: 'Inspect an invite.',
      method: 'GET',
      schema: z.object({ code: z.string().regex(/^[\w-]+$/) }),
      path: (a) => `/invites/${a.code}?with_counts=true`,
    }),
    restTool({
      name: 'invites_create',
      description: 'Create a channel invite.',
      method: 'POST',
      schema: channel.extend({
        max_age: z.number().int().min(0).max(604800).default(86400),
        max_uses: z.number().int().min(0).max(100).default(0),
        temporary: z.boolean().default(false),
      }),
      path: (a) => `/channels/${a.channel_id}/invites`,
      body: (a) => ({
        max_age: a.max_age,
        max_uses: a.max_uses,
        temporary: a.temporary,
      }),
    }),
    restTool({
      name: 'invites_delete',
      description: 'Revoke an invite.',
      method: 'DELETE',
      schema: z.object({ code: z.string().regex(/^[\w-]+$/) }),
      path: (a) => `/invites/${a.code}`,
      destructive: true,
    }),
  ],
};
