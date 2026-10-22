import { z } from 'zod';
import { guild, id } from '../params.js';
import { restTool, type Category } from '../types.js';

const fields = {
  name: z.string().min(1).max(100),
  permissions: z.string().regex(/^\d+$/).optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
};
export const roles: Category = {
  name: 'roles',
  description: 'Guild roles and permissions',
  tools: [
    restTool({
      name: 'roles_list',
      description: 'List guild roles.',
      method: 'GET',
      schema: guild,
      path: (a) => `/guilds/${a.guild_id}/roles`,
    }),
    restTool({
      name: 'roles_create',
      description: 'Create a role.',
      method: 'POST',
      schema: guild.extend(fields),
      path: (a) => `/guilds/${a.guild_id}/roles`,
      body: (a) => ({
        name: a.name,
        permissions: a.permissions,
        color: a.color,
        hoist: a.hoist,
        mentionable: a.mentionable,
      }),
    }),
    restTool({
      name: 'roles_edit',
      description: 'Update a role.',
      method: 'PATCH',
      schema: guild.extend({ ...fields, role_id: id }),
      path: (a) => `/guilds/${a.guild_id}/roles/${a.role_id}`,
      body: (a) => ({
        name: a.name,
        permissions: a.permissions,
        color: a.color,
        hoist: a.hoist,
        mentionable: a.mentionable,
      }),
    }),
    restTool({
      name: 'roles_delete',
      description: 'Delete a role.',
      method: 'DELETE',
      schema: guild.extend({ role_id: id }),
      path: (a) => `/guilds/${a.guild_id}/roles/${a.role_id}`,
      destructive: true,
    }),
  ],
};
