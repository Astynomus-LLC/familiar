import { z } from 'zod';
import type { Category } from '../types.js';

export const core: Category = {
  name: 'core',
  description: 'Bot identity and session orientation',
  tools: [
    {
      name: 'whoami',
      description: 'Show the acting bot.',
      schema: z.object({}),
      mutating: false,
      execute: ({ bot, manager }) => ({
        id: bot.id,
        ...manager.status(bot.slug),
      }),
    },
    {
      name: 'list_bots',
      description: 'List available bots.',
      schema: z.object({}),
      mutating: false,
      execute: ({ bots, manager }) =>
        bots.map((bot) => ({
          slug: bot.slug,
          name: bot.name,
          ...manager.status(bot.slug),
        })),
    },
    {
      name: 'set_active_bot',
      description: 'Set this session’s active bot.',
      schema: z.object({ slug: z.string() }),
      mutating: false,
      execute: ({ setActiveBot }, args) => {
        setActiveBot(args.slug as string);
        return { active: args.slug };
      },
    },
  ],
};
