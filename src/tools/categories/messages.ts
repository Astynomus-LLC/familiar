import { z } from 'zod';
import { restTool, type Category } from '../types.js';

const channel = z.object({ channel_id: z.string().regex(/^\d+$/) });
const message = channel.extend({ message_id: z.string().regex(/^\d+$/) });

export const messages: Category = {
  name: 'messages',
  description: 'Read, send, edit, delete, and pin messages',
  tools: [
    restTool({
      name: 'messages_list',
      description: 'Read recent channel messages.',
      method: 'GET',
      schema: channel.extend({
        limit: z.number().int().min(1).max(100).default(50),
        before: z.string().regex(/^\d+$/).optional(),
      }),
      path: (a) =>
        `/channels/${a.channel_id}/messages?limit=${a.limit}${a.before ? `&before=${a.before}` : ''}`,
    }),
    restTool({
      name: 'messages_get',
      description: 'Read a message.',
      method: 'GET',
      schema: message,
      path: (a) => `/channels/${a.channel_id}/messages/${a.message_id}`,
    }),
    restTool({
      name: 'messages_send',
      description: 'Send a message. Mentions are disabled by default.',
      method: 'POST',
      schema: channel.extend({ content: z.string().min(1).max(2000) }),
      path: (a) => `/channels/${a.channel_id}/messages`,
      body: (a) => ({ content: a.content, allowed_mentions: { parse: [] } }),
    }),
    restTool({
      name: 'messages_edit',
      description: 'Edit a bot message.',
      method: 'PATCH',
      schema: message.extend({ content: z.string().min(1).max(2000) }),
      path: (a) => `/channels/${a.channel_id}/messages/${a.message_id}`,
      body: (a) => ({ content: a.content, allowed_mentions: { parse: [] } }),
    }),
    restTool({
      name: 'messages_delete',
      description: 'Delete a message.',
      method: 'DELETE',
      schema: message,
      path: (a) => `/channels/${a.channel_id}/messages/${a.message_id}`,
      destructive: true,
    }),
    restTool({
      name: 'messages_bulk_delete',
      description: 'Delete 2–100 messages younger than 14 days.',
      method: 'POST',
      schema: channel.extend({
        message_ids: z.array(z.string().regex(/^\d+$/)).min(2).max(100),
      }),
      path: (a) => `/channels/${a.channel_id}/messages/bulk-delete`,
      body: (a) => ({ messages: a.message_ids }),
      destructive: true,
    }),
    restTool({
      name: 'messages_pin',
      description: 'Pin a message.',
      method: 'PUT',
      schema: message,
      path: (a) => `/channels/${a.channel_id}/pins/${a.message_id}`,
    }),
  ],
};
