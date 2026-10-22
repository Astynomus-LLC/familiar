import { z } from 'zod';
import { channel, id } from '../params.js';
import { restTool, type Category } from '../types.js';

export const webhooks: Category = {
  name: 'webhooks',
  description: 'Manage channel webhooks',
  tools: [
    restTool({
      name: 'webhooks_list',
      description: 'List channel webhooks.',
      method: 'GET',
      schema: channel,
      path: (a) => `/channels/${a.channel_id}/webhooks`,
    }),
    restTool({
      name: 'webhooks_create',
      description: 'Create a webhook.',
      method: 'POST',
      schema: channel.extend({ name: z.string().min(1).max(80) }),
      path: (a) => `/channels/${a.channel_id}/webhooks`,
      body: (a) => ({ name: a.name }),
    }),
    restTool({
      name: 'webhooks_edit',
      description: 'Rename a webhook.',
      method: 'PATCH',
      schema: z.object({ webhook_id: id, name: z.string().min(1).max(80) }),
      path: (a) => `/webhooks/${a.webhook_id}`,
      body: (a) => ({ name: a.name }),
    }),
    restTool({
      name: 'webhooks_delete',
      description: 'Delete a webhook.',
      method: 'DELETE',
      schema: z.object({ webhook_id: id }),
      path: (a) => `/webhooks/${a.webhook_id}`,
      destructive: true,
    }),
  ],
};
