import { z } from 'zod';
import { FeatureEngine } from '../features/engine.js';
import { features } from '../features/registry.js';
import { gatewaySettings, type GatewaySettings } from '../features/types.js';
import {
  joinVoiceChannel,
  getVoiceConnection,
  getVoiceConnections,
  entersState,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import {
  Client,
  GatewayIntentBits,
  REST,
  RequestMethod,
  Options,
  Partials,
} from 'discord.js';
import type { APIUser } from 'discord.js';
import type { Bot, Store } from '../storage/store.js';
import type { SecretBox } from '../storage/secrets.js';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface Upload {
  name: string;
  data: string;
  contentType?: string;
  key?: string;
}

export interface DiscordConnection {
  request(
    method: Method,
    path: string,
    body?: unknown,
    files?: Upload[],
    form?: boolean,
  ): Promise<unknown>;
  client?: Client;
  login(): Promise<void>;
  voice(guildId: string, channelId: string | null): Promise<unknown>;
  destroy(): void;
  status(): { state: string; guilds: number };
}
export type ConnectionFactory = (
  token: string,
  settings?: GatewaySettings,
) => DiscordConnection;

export const discordConnection: ConnectionFactory = (
  token,
  settings = gatewaySettings.parse({}),
) => {
  const rest = new REST({
    version: '10',
    retries: 2,
    timeout: 15_000,
  }).setToken(token);
  const client = new Client({
    intents: settings.intents.map((name) => GatewayIntentBits[name]),
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: settings.messageCacheSize,
    }),
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.GuildMember,
      Partials.User,
    ],
  });
  let state = 'offline';
  client.on('error', () => {
    state = 'offline';
  });
  client.on('shardError', () => {
    state = 'offline';
  });
  client.on('shardDisconnect', () => {
    state = 'offline';
  });
  client.on('clientReady', () => {
    state = 'online';
  });
  return {
    client,
    async request(method, path, body, files, form) {
      const url = new URL(path, 'https://discord.com');
      return rest.request({
        method: method as RequestMethod,
        fullRoute: url.pathname as `/${string}`,
        query: url.searchParams,
        body,
        appendToFormData: form,
        files: files?.map((file) => ({
          name: file.name,
          key: file.key,
          data: Buffer.from(file.data, 'base64'),
          contentType: file.contentType,
        })),
      });
    },
    async login() {
      state = 'connecting';
      try {
        await client.login(token);
      } catch {
        state = 'offline';
        client.destroy();
        throw new Error(
          'Bot login failed. Check the token and application gateway settings.',
        );
      }
    },
    async voice(guildId, channelId) {
      if (!client.isReady())
        throw new Error(
          'Bot offline. Voice management requires a gateway connection.',
        );
      if (channelId === null) {
        getVoiceConnection(guildId, client.user.id)?.destroy();
        return { connected: false };
      }
      const guild = await client.guilds.fetch(guildId);
      const connection = joinVoiceChannel({
        guildId,
        channelId,
        adapterCreator: guild.voiceAdapterCreator,
        group: client.user.id,
        selfDeaf: true,
        selfMute: true,
      });
      connection.on('error', () => {
        console.error(`Bot ${client.user?.username}: voice connection failed.`);
        if (connection.state.status !== VoiceConnectionStatus.Destroyed)
          connection.destroy();
      });
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed)
          connection.destroy();
        throw new Error(
          'Could not join voice channel. Check permissions and connectivity.',
        );
      }
      return { connected: true, channel_id: channelId };
    },
    destroy() {
      if (client.user)
        for (const connection of getVoiceConnections(
          client.user.id,
        )?.values() ?? [])
          connection.destroy();
      client.destroy();
      state = 'offline';
    },
    status() {
      return {
        state: client.isReady() ? 'online' : state,
        guilds: client.guilds.cache.size,
      };
    },
  };
};

export class BotManager {
  private readonly connections = new Map<string, DiscordConnection>();
  private readonly engines = new Map<string, FeatureEngine>();
  private readonly failures = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    private readonly factory: ConnectionFactory = discordConnection,
  ) {}

  async save(slug: string, token: string, categories: string[]): Promise<Bot> {
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(slug))
      throw new Error(
        'Use a bot slug with lowercase letters, numbers, and hyphens.',
      );
    const previous = this.store.bots().find((bot) => bot.slug === slug);
    const settings = gatewaySettings.parse(previous ?? {});
    const connection = this.factory(token, settings);
    let identity: APIUser;
    try {
      identity = (await connection.request('GET', '/users/@me')) as APIUser;
      if (!identity.bot) throw new Error('Not a bot');
    } catch {
      connection.destroy();
      throw new Error(
        'Token validation failed. Supply a valid Discord bot token.',
      );
    }
    const bot: Bot = {
      slug,
      id: identity.id,
      name: identity.username,
      avatar: identity.avatar,
      token: this.secrets.encrypt(token),
      categories,
      ...settings,
    };
    if (previous && previous.id !== bot.id) {
      connection.destroy();
      throw new Error('This slug belongs to a different bot. Use a new slug.');
    }
    this.engines.get(slug)?.close();
    this.store.saveBot(bot);
    this.connections.get(slug)?.destroy();
    this.connections.set(slug, connection);
    this.failures.delete(slug);
    if (connection.client)
      this.engines.set(
        slug,
        new FeatureEngine(this.store, bot, connection.client),
      );
    await this.login(slug, connection);
    return bot;
  }

  async start(): Promise<void> {
    await Promise.all(
      this.store.bots().map(async (bot) => {
        try {
          const connection = this.factory(
            this.secrets.decrypt(bot.token),
            gatewaySettings.parse(bot),
          );
          this.connections.set(bot.slug, connection);
          if (connection.client)
            this.engines.set(
              bot.slug,
              new FeatureEngine(this.store, bot, connection.client),
            );
          await this.login(bot.slug, connection);
        } catch {
          this.failures.set(
            bot.slug,
            'Stored token cannot be decrypted. Re-enter the token with the current MASTER_SECRET.',
          );
          console.error(`Bot ${bot.slug}: stored token cannot be decrypted.`);
        }
      }),
    );
  }

  private async login(
    slug: string,
    connection: DiscordConnection,
  ): Promise<void> {
    try {
      await connection.login();
    } catch {
      this.failures.set(
        slug,
        'Bot offline. Check the token and Discord application settings.',
      );
      console.error(
        `Bot ${slug}: offline; check token and Discord application settings.`,
      );
    }
  }

  status(slug: string): { state: string; guilds: number; error?: string } {
    return {
      ...(this.connections.get(slug)?.status() ?? {
        state: 'offline',
        guilds: 0,
      }),
      error: this.failures.get(slug),
    };
  }

  async request(
    bot: Bot,
    method: Method,
    path: string,
    body?: unknown,
    files?: Upload[],
    form?: boolean,
  ): Promise<unknown> {
    if (
      !/^\/(?!\/)/.test(path) ||
      /[\\#\s]/.test(path) ||
      path.split(/[/?]/).some((part) => part === '..' || part === '.')
    )
      throw new Error('Use a relative Discord API path, such as /users/@me.');
    const connection = this.connections.get(bot.slug);
    if (!connection)
      throw new Error('Bot offline. Re-enter its token in Familiar.');
    try {
      return await connection.request(method, path, body, files, form);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'status' in error
          ? String(error.status)
          : 'unavailable';
      // Discord errors can contain request bodies and credentials. Do not retain them.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(
        `Discord request failed (${code}). Check bot permissions, token, and target.`,
      );
    }
  }

  async voice(
    slug: string,
    guildId: string,
    channelId: string | null,
  ): Promise<unknown> {
    const connection = this.connections.get(slug);
    if (!connection) throw new Error('Bot offline.');
    return connection.voice(guildId, channelId);
  }

  async updateGateway(bot: Bot, input: GatewaySettings) {
    const settings = gatewaySettings.parse(input);
    this.engines.get(bot.slug)?.close();
    this.connections.get(bot.slug)?.destroy();
    const updated = { ...bot, ...settings };
    this.store.saveBot(updated);
    const connection = this.factory(this.secrets.decrypt(bot.token), settings);
    this.connections.set(bot.slug, connection);
    this.failures.delete(bot.slug);
    if (connection.client)
      this.engines.set(
        bot.slug,
        new FeatureEngine(this.store, updated, connection.client),
      );
    await this.login(bot.slug, connection);
  }

  async guilds(bot: Bot): Promise<{ id: string; name: string }[]> {
    const result: { id: string; name: string }[] = [];
    let after = '';
    for (;;) {
      const page = (await this.request(
        bot,
        'GET',
        `/users/@me/guilds?limit=200${after ? `&after=${after}` : ''}`,
      )) as { id: string; name: string }[];
      if (!Array.isArray(page)) throw new Error('Could not list bot guilds.');
      result.push(...page);
      if (page.length < 200) return result;
      after = page[page.length - 1].id;
    }
  }

  async resolveGuilds(bot: Bot, address: string) {
    const guilds = await this.guilds(bot);
    if (address === 'all') return guilds;
    const byId = guilds.find((g) => g.id === address);
    if (byId) return [byId];
    const matches = guilds.filter((g) => g.name === address);
    if (matches.length > 1)
      throw new Error(
        `Ambiguous guild name: ${matches.map((g) => `${g.name} (${g.id})`).join(', ')}`,
      );
    if (!matches.length) throw new Error('Guild not found for this bot.');
    return matches;
  }

  featureStates(bot: Bot, guildId: string) {
    const instances = this.store.featureInstances(bot.id, guildId);
    return features.map((feature) => {
      const instance = instances.find((i) => i.featureId === feature.id);
      const missingIntents = feature.requiredIntents.filter(
        (i) => !gatewaySettings.parse(bot).intents.includes(i),
      );
      return {
        botId: bot.id,
        guildId,
        featureId: feature.id,
        name: feature.name,
        description: feature.description,
        configSchema: z.toJSONSchema(feature.configSchema),
        enabled: instance?.enabled ?? false,
        config: instance?.config ?? null,
        missingIntents,
        state: !instance?.enabled
          ? 'disabled'
          : missingIntents.length
            ? 'degraded'
            : 'enabled',
      };
    });
  }

  async configureFeature(
    bot: Bot,
    address: string,
    featureId: string,
    patch?: Record<string, unknown>,
    enabled?: boolean,
  ) {
    const feature = features.find((f) => f.id === featureId);
    if (!feature) throw new Error('Unknown feature.');
    const guilds = await this.resolveGuilds(bot, address);
    const instances = guilds.flatMap((guild) => {
      const old = this.store
        .featureInstances(bot.id, guild.id)
        .find((i) => i.featureId === featureId);
      if (!old && enabled === false) return [];
      if (!old && enabled !== true)
        throw new Error('Enable this feature with its required config first.');
      const config = feature.configSchema.parse({ ...old?.config, ...patch });
      return [
        {
          botId: bot.id,
          guildId: guild.id,
          featureId,
          enabled: enabled ?? old?.enabled ?? false,
          config,
        },
      ];
    });
    this.store.saveFeatureInstances(instances);
    return instances;
  }

  remove(slug: string): void {
    this.engines.get(slug)?.close();
    this.engines.delete(slug);
    this.connections.get(slug)?.destroy();
    this.connections.delete(slug);
    this.failures.delete(slug);
    this.store.deleteBot(slug);
  }

  close(): void {
    for (const engine of this.engines.values()) engine.close();
    for (const connection of this.connections.values()) connection.destroy();
  }
}
