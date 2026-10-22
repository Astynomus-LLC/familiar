import { featureTools } from './categories/features.js';
import { channels } from './categories/channels.js';
import { threads } from './categories/threads.js';
import { members } from './categories/members.js';
import { roles } from './categories/roles.js';
import { moderation } from './categories/moderation.js';
import { webhooks } from './categories/webhooks.js';
import { emojisStickers } from './categories/emojis-stickers.js';
import { scheduledEvents } from './categories/scheduled-events.js';
import { automod } from './categories/automod.js';
import { invites } from './categories/invites.js';
import { auditLog } from './categories/audit-log.js';
import { applicationCommands } from './categories/application-commands.js';
import { guilds } from './categories/guilds.js';
import { users } from './categories/users.js';
import { voice } from './categories/voice.js';
import { core } from './categories/core.js';
import { rawApi } from './categories/raw-api.js';
import { messages } from './categories/messages.js';
import type { Category } from './types.js';

export const categories: Category[] = [
  core,
  featureTools,
  rawApi,
  messages,
  channels,
  threads,
  members,
  roles,
  moderation,
  webhooks,
  emojisStickers,
  scheduledEvents,
  automod,
  invites,
  auditLog,
  applicationCommands,
  guilds,
  users,
  voice,
];
export const alwaysOn = new Set(['core', 'raw_api']);

export function validateCategories(names: string[]): void {
  if (
    names.some((name) => !categories.some((category) => category.name === name))
  )
    throw new Error('Unknown category.');
}
