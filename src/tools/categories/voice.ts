import { z } from 'zod';
import { guild, id, member } from '../params.js';
import { restTool, type Category } from '../types.js';

export const voice: Category = {
  name: 'voice',
  description: 'Join, leave, and manage voice channels; no audio streaming',
  tools: [
    {
      name: 'voice_join',
      description: 'Join a guild voice channel without transmitting audio.',
      schema: guild.extend({ channel_id: id }),
      mutating: true,
      execute: ({ bot, manager }, a) =>
        manager.voice(bot.slug, a.guild_id as string, a.channel_id as string),
    },
    {
      name: 'voice_leave',
      description: 'Leave a guild voice channel.',
      schema: guild,
      mutating: true,
      execute: ({ bot, manager }, a) =>
        manager.voice(bot.slug, a.guild_id as string, null),
    },
    restTool({
      name: 'voice_move_member',
      description: 'Move or disconnect a connected member.',
      method: 'PATCH',
      schema: member.extend({ channel_id: id.nullable() }),
      path: (a) => `/guilds/${a.guild_id}/members/${a.user_id}`,
      body: (a) => ({ channel_id: a.channel_id }),
      destructive: true,
    }),
    restTool({
      name: 'voice_mute_member',
      description: 'Set server mute and deafen state.',
      method: 'PATCH',
      schema: member.extend({ mute: z.boolean(), deaf: z.boolean() }),
      path: (a) => `/guilds/${a.guild_id}/members/${a.user_id}`,
      body: (a) => ({ mute: a.mute, deaf: a.deaf }),
    }),
  ],
};
