import { z } from 'zod';
import type { Feature } from './types.js';
import { snowflake } from './types.js';
export const autorole: Feature = {
  id: 'autorole',
  module: 'members',
  label: 'Autorole',
  fields: {
    roleIds: {
      type: 'roles',
      label: 'Assigned roles',
      help: 'Roles to give new members. Place the bot’s role above these roles.',
    },
    skipBots: {
      type: 'toggle',
      label: 'Skip bots',
      help: 'Only assign roles to people.',
    },
    delaySeconds: {
      type: 'number',
      label: 'Delay in seconds',
      help: 'Wait up to five minutes before assigning roles.',
    },
  },
  name: 'Autorole',
  description: 'Assign roles when a member joins.',
  configSchema: z.object({
    roleIds: z.array(snowflake).min(1),
    skipBots: z.boolean().default(true),
    delaySeconds: z.number().min(0).max(300).default(0),
  }),
  requiredIntents: ['GuildMembers'],
  events: [
    {
      name: 'guildMemberAdd',
      intents: ['GuildMembers'],
      async handle(ctx, member) {
        if (ctx.config.skipBots && member.user.bot) return;
        if (ctx.config.delaySeconds)
          await new Promise((resolve) => {
            const timer = setTimeout(
              resolve,
              Number(ctx.config.delaySeconds) * 1000,
            );
            timer.unref();
          });
        if (ctx.active()) await member.roles.add(ctx.config.roleIds);
      },
    },
  ],
};
