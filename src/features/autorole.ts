import { z } from 'zod';
import type { Feature } from './types.js';
import { snowflake } from './types.js';
export const autorole: Feature = {
  id: 'autorole',
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
