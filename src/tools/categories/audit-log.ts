import { z } from 'zod';
import { guild, id } from '../params.js';
import { restTool, type Category } from '../types.js';

export const auditLog: Category = {
  name: 'audit_log',
  description: 'Discord guild audit logs',
  tools: [
    restTool({
      name: 'audit_log_list',
      description: 'Read Discord guild audit log entries.',
      method: 'GET',
      schema: guild.extend({
        limit: z.number().int().min(1).max(100).default(50),
        before: id.optional(),
      }),
      path: (a) =>
        `/guilds/${a.guild_id}/audit-logs?limit=${a.limit}${a.before ? `&before=${a.before}` : ''}`,
    }),
  ],
};
