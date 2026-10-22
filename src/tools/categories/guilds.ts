import { z } from 'zod';
import { guild } from '../params.js';
import { restTool, type Category } from '../types.js';

export const guilds: Category = {
  name: 'guilds',
  description: 'Guild information and settings',
  tools: [
    restTool({
      name: 'guilds_list',
      description: 'List bot guilds.',
      method: 'GET',
      schema: z.object({}),
      path: () => '/users/@me/guilds',
    }),
    restTool({
      name: 'guilds_get',
      description: 'Get guild details and approximate member counts.',
      method: 'GET',
      schema: guild,
      path: (a) => `/guilds/${a.guild_id}?with_counts=true`,
    }),
    restTool({
      name: 'guilds_rename',
      description: 'Rename a guild.',
      method: 'PATCH',
      schema: guild.extend({ name: z.string().min(2).max(100) }),
      path: (a) => `/guilds/${a.guild_id}`,
      body: (a) => ({ name: a.name }),
    }),
    restTool({
      name: 'guilds_leave',
      description: 'Remove the acting bot from a guild.',
      method: 'DELETE',
      schema: guild,
      path: (a) => `/users/@me/guilds/${a.guild_id}`,
      destructive: true,
    }),
  ],
};
