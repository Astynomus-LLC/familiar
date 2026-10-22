import { z } from 'zod';
import { guild, id } from '../params.js';
import { restTool, type Category } from '../types.js';

export const scheduledEvents: Category = {
  name: 'scheduled_events',
  description: 'Guild scheduled events',
  tools: [
    restTool({
      name: 'events_list',
      description: 'List scheduled guild events.',
      method: 'GET',
      schema: guild,
      path: (a) =>
        `/guilds/${a.guild_id}/scheduled-events?with_user_count=true`,
    }),
    restTool({
      name: 'events_create',
      description: 'Create an external scheduled event.',
      method: 'POST',
      schema: guild.extend({
        name: z.string().min(1).max(100),
        location: z.string().min(1).max(100),
        start: z.iso.datetime(),
        end: z.iso.datetime(),
        description: z.string().max(1000).optional(),
      }),
      path: (a) => `/guilds/${a.guild_id}/scheduled-events`,
      body: (a) => ({
        name: a.name,
        entity_type: 3,
        privacy_level: 2,
        entity_metadata: { location: a.location },
        scheduled_start_time: a.start,
        scheduled_end_time: a.end,
        description: a.description,
      }),
    }),
    restTool({
      name: 'events_status',
      description: 'Start, complete, or cancel an event.',
      method: 'PATCH',
      schema: guild.extend({
        event_id: id,
        status: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      }),
      path: (a) => `/guilds/${a.guild_id}/scheduled-events/${a.event_id}`,
      body: (a) => ({ status: a.status }),
      destructive: true,
    }),
    restTool({
      name: 'events_delete',
      description: 'Delete a scheduled event.',
      method: 'DELETE',
      schema: guild.extend({ event_id: id }),
      path: (a) => `/guilds/${a.guild_id}/scheduled-events/${a.event_id}`,
      destructive: true,
    }),
  ],
};
