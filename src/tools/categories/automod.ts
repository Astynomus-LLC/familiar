import { z } from 'zod';
import { guild, id } from '../params.js';
import { restTool, type Category } from '../types.js';

export const automod: Category = {
  name: 'automod',
  description: 'Auto Moderation rules',
  tools: [
    restTool({
      name: 'automod_list',
      description: 'List Auto Moderation rules.',
      method: 'GET',
      schema: guild,
      path: (a) => `/guilds/${a.guild_id}/auto-moderation/rules`,
    }),
    restTool({
      name: 'automod_create',
      description: 'Create an enabled keyword-blocking rule.',
      method: 'POST',
      schema: guild.extend({
        name: z.string().min(1).max(100),
        keywords: z.array(z.string().min(1).max(60)).min(1).max(1000),
      }),
      path: (a) => `/guilds/${a.guild_id}/auto-moderation/rules`,
      body: (a) => ({
        name: a.name,
        event_type: 1,
        trigger_type: 1,
        trigger_metadata: { keyword_filter: a.keywords },
        actions: [{ type: 1 }],
        enabled: true,
      }),
    }),
    restTool({
      name: 'automod_toggle',
      description: 'Enable or disable a rule.',
      method: 'PATCH',
      schema: guild.extend({ rule_id: id, enabled: z.boolean() }),
      path: (a) => `/guilds/${a.guild_id}/auto-moderation/rules/${a.rule_id}`,
      body: (a) => ({ enabled: a.enabled }),
    }),
    restTool({
      name: 'automod_delete',
      description: 'Delete an Auto Moderation rule.',
      method: 'DELETE',
      schema: guild.extend({ rule_id: id }),
      path: (a) => `/guilds/${a.guild_id}/auto-moderation/rules/${a.rule_id}`,
      destructive: true,
    }),
  ],
};
