import { z } from 'zod';
import { guild, id } from '../params.js';
import { restTool, type Category } from '../types.js';

export const emojisStickers: Category = {
  name: 'emojis_stickers',
  description: 'Guild emojis and stickers',
  tools: [
    restTool({
      name: 'emojis_list',
      description: 'List guild emojis.',
      method: 'GET',
      schema: guild,
      path: (a) => `/guilds/${a.guild_id}/emojis`,
    }),
    restTool({
      name: 'emojis_create',
      description: 'Create an emoji from a base64 image data URI.',
      method: 'POST',
      schema: guild.extend({
        name: z.string().min(2).max(32),
        image: z.string().startsWith('data:image/'),
      }),
      path: (a) => `/guilds/${a.guild_id}/emojis`,
      body: (a) => ({ name: a.name, image: a.image }),
    }),
    restTool({
      name: 'emojis_delete',
      description: 'Delete an emoji.',
      method: 'DELETE',
      schema: guild.extend({ emoji_id: id }),
      path: (a) => `/guilds/${a.guild_id}/emojis/${a.emoji_id}`,
      destructive: true,
    }),
    restTool({
      name: 'stickers_list',
      description: 'List guild stickers.',
      method: 'GET',
      schema: guild,
      path: (a) => `/guilds/${a.guild_id}/stickers`,
    }),
    restTool({
      name: 'stickers_edit',
      description: 'Update a sticker.',
      method: 'PATCH',
      schema: guild.extend({
        sticker_id: id,
        name: z.string().min(2).max(30),
        description: z.string().max(100).nullable(),
        tags: z.string().max(200),
      }),
      path: (a) => `/guilds/${a.guild_id}/stickers/${a.sticker_id}`,
      body: (a) => ({ name: a.name, description: a.description, tags: a.tags }),
    }),
    restTool({
      name: 'stickers_delete',
      description: 'Delete a sticker.',
      method: 'DELETE',
      schema: guild.extend({ sticker_id: id }),
      path: (a) => `/guilds/${a.guild_id}/stickers/${a.sticker_id}`,
      destructive: true,
    }),
  ],
};
