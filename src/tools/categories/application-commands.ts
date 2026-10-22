import { z } from 'zod';
import { id } from '../params.js';
import { restTool, type Category } from '../types.js';

const scope = z.object({ application_id: id, guild_id: id.optional() });
const path = (a: Record<string, unknown>) =>
  `/applications/${a.application_id}${a.guild_id ? `/guilds/${a.guild_id}` : ''}/commands`;
export const applicationCommands: Category = {
  name: 'application_commands',
  description: 'Manage application command definitions',
  tools: [
    restTool({
      name: 'commands_list',
      description: 'List global or guild commands.',
      method: 'GET',
      schema: scope,
      path,
    }),
    restTool({
      name: 'commands_create',
      description:
        'Register a slash command definition. Familiar does not implement interaction handlers.',
      method: 'POST',
      schema: scope.extend({
        name: z.string().min(1).max(32),
        description: z.string().min(1).max(100),
      }),
      path,
      body: (a) => ({ name: a.name, description: a.description, type: 1 }),
    }),
    restTool({
      name: 'commands_delete',
      description: 'Delete a command definition.',
      method: 'DELETE',
      schema: scope.extend({ command_id: id }),
      path: (a) => `${path(a)}/${a.command_id}`,
      destructive: true,
    }),
  ],
};
