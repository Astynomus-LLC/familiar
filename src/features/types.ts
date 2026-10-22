/* eslint-disable @typescript-eslint/no-explicit-any -- Discord event tuples have different payload shapes; the registry is the dynamic dispatch boundary. */
import { z } from 'zod';
import type { Client, Guild } from 'discord.js';
export const intentNames = [
  'Guilds',
  'GuildMessages',
  'GuildMembers',
  'GuildModeration',
  'GuildMessageReactions',
  'GuildScheduledEvents',
  'GuildVoiceStates',
  'MessageContent',
  'GuildPresences',
] as const;
export const gatewaySettings = z.object({
  intents: z.array(z.enum(intentNames)).default(['Guilds', 'GuildVoiceStates']),
  messageCacheSize: z.number().int().min(0).max(10000).default(200),
});
export type GatewaySettings = z.infer<typeof gatewaySettings>;
export interface FeatureInstance {
  botId: string;
  guildId: string;
  featureId: string;
  enabled: boolean;
  config: Record<string, unknown>;
}
export interface FeatureContext {
  client: Client;
  guild: Guild;
  config: Record<string, unknown>;
  intents: GatewaySettings['intents'];
  logger: (message: string) => void;
  active: () => boolean;
}
export interface Feature {
  id: string;
  name: string;
  description: string;
  configSchema: z.ZodObject;
  requiredIntents: (typeof intentNames)[number][];
  events: {
    name: string;
    intents: (typeof intentNames)[number][];
    handle: (context: FeatureContext, ...args: any[]) => Promise<void>;
  }[];
  slashCommands?: {
    name: string;
    description: string;
    handle: (context: FeatureContext, interaction: any) => Promise<void>;
  }[];
  messageCommands?: {
    name: string;
    handle: (context: FeatureContext, message: any) => Promise<void>;
  }[];
}
export const snowflake = z.string().regex(/^\d+$/);
