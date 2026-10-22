import { z } from 'zod';
import { guild, member, id } from '../params.js';
import { restTool, type Category } from '../types.js';

export const members: Category = {
  name: 'members',
  description: 'Guild membership, nicknames, and member roles',
  tools: [
    restTool({
      name: 'members_list',
      description:
        'List guild members; requires the Guild Members privileged intent.',
      method: 'GET',
      schema: guild.extend({
        limit: z.number().int().min(1).max(1000).default(100),
        after: id.optional(),
      }),
      path: (a) =>
        `/guilds/${a.guild_id}/members?limit=${a.limit}${a.after ? `&after=${a.after}` : ''}`,
    }),
    restTool({
      name: 'members_get',
      description: 'Get a guild member.',
      method: 'GET',
      schema: member,
      path: (a) => `/guilds/${a.guild_id}/members/${a.user_id}`,
    }),
    restTool({
      name: 'members_nickname',
      description: 'Change a member nickname.',
      method: 'PATCH',
      schema: member.extend({ nick: z.string().max(32).nullable() }),
      path: (a) => `/guilds/${a.guild_id}/members/${a.user_id}`,
      body: (a) => ({ nick: a.nick }),
    }),
    restTool({
      name: 'members_add_role',
      description: 'Assign a member role.',
      method: 'PUT',
      schema: member.extend({ role_id: id }),
      path: (a) =>
        `/guilds/${a.guild_id}/members/${a.user_id}/roles/${a.role_id}`,
    }),
    restTool({
      name: 'members_remove_role',
      description: 'Remove a member role.',
      method: 'DELETE',
      schema: member.extend({ role_id: id }),
      path: (a) =>
        `/guilds/${a.guild_id}/members/${a.user_id}/roles/${a.role_id}`,
      destructive: true,
    }),
  ],
};
