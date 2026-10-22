import { z } from 'zod';
import { user } from '../params.js';
import { restTool, type Category } from '../types.js';

export const users: Category = {
  name: 'users',
  description: 'User profiles and bot direct-message channels',
  tools: [
    restTool({
      name: 'users_get',
      description: 'Get a user profile.',
      method: 'GET',
      schema: user,
      path: (a) => `/users/${a.user_id}`,
    }),
    restTool({
      name: 'users_open_dm',
      description: 'Open a direct-message channel.',
      method: 'POST',
      schema: user,
      path: () => '/users/@me/channels',
      body: (a) => ({ recipient_id: a.user_id }),
    }),
    restTool({
      name: 'users_edit_self',
      description: 'Change the bot username.',
      method: 'PATCH',
      schema: z.object({ username: z.string().min(2).max(32) }),
      path: () => '/users/@me',
      body: (a) => ({ username: a.username }),
    }),
  ],
};
