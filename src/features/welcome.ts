import { z } from 'zod';
import type { Feature } from './types.js';
import { snowflake } from './types.js';
export const welcome: Feature = {
  id: 'welcome',
  module: 'members',
  label: 'Welcome',
  fields: {
    channelId: {
      type: 'channel',
      label: 'Welcome channel',
      help: 'Where to greet new members.',
    },
    template: {
      type: 'textarea',
      label: 'Welcome message',
      help: 'Use {user}, {server}, and {memberCount} in your message.',
    },
    dmEnabled: {
      type: 'toggle',
      label: 'Send a direct message',
      help: 'Also welcome members privately.',
    },
    dmTemplate: {
      type: 'textarea',
      label: 'Direct message',
      help: 'Use the same placeholders as the welcome message.',
    },
  },
  name: 'Welcome',
  description: 'Welcome new members with a template.',
  configSchema: z.object({
    channelId: snowflake,
    template: z
      .string()
      .min(1)
      .max(2000)
      .default('Welcome {user} to {server}!'),
    dmEnabled: z.boolean().default(false),
    dmTemplate: z.string().max(2000).default('Welcome to {server}!'),
  }),
  requiredIntents: ['GuildMembers'],
  events: [
    {
      name: 'guildMemberAdd',
      intents: ['GuildMembers'],
      async handle(ctx, member) {
        const render = (value: unknown) =>
          String(value)
            .replace(
              /\{(user|server|memberCount)\}/g,
              (_, key: string) =>
                ({
                  user: `<@${member.id}>`,
                  server: ctx.guild.name,
                  memberCount: String(ctx.guild.memberCount),
                })[key]!,
            )
            .slice(0, 2000);
        const channel = await ctx.guild.channels.fetch(
          String(ctx.config.channelId),
        );
        if (channel?.isTextBased() && 'send' in channel)
          await channel.send({
            content: render(ctx.config.template),
            allowedMentions: { parse: [], users: [member.id] },
          });
        if (ctx.config.dmEnabled)
          await member.send({
            content: render(ctx.config.dmTemplate),
            allowedMentions: { parse: [] },
          });
      },
    },
  ],
};
