import type { ModAction, ModCase } from '../storage/cases.js';
import { escalate, moderationModule, notify } from '../features/moderation.js';
import { duration, publishModeration } from '../features/moderation-service.js';
import { z } from 'zod';
import { FeatureEngine } from '../features/engine.js';
import { features, modules } from '../features/registry.js';
import {
  gatewaySettings,
  type ConfigField,
  type GatewaySettings,
} from '../features/types.js';
import {
  joinVoiceChannel,
  getVoiceConnection,
  getVoiceConnections,
  entersState,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import {
  Client,
  PermissionFlagsBits,
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

function parseConfig(
  schema: z.ZodObject,
  fields: Record<string, ConfigField>,
  config: Record<string, unknown>,
) {
  const result = schema.safeParse(config);
  if (!result.success)
    throw new Error(
      result.error.issues
        .map(
          (issue) =>
            `${fields[String(issue.path[0])]?.label ?? 'Settings'}: ${issue.message}`,
        )
        .join('; '),
    );
  return result.data;
}

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

  async guilds(
    bot: Bot,
  ): Promise<{ id: string; name: string; icon?: string | null }[]> {
    const result: { id: string; name: string; icon?: string | null }[] = [];
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

  async getModlogs(
    bot: Bot,
    address: string,
    userId?: string,
    before?: number,
  ) {
    if (address === 'all') throw new Error('Select one guild.');
    const [guild] = await this.resolveGuilds(bot, address);
    return {
      cases: this.store.modCases(guild.id, userId, before),
      activeWarnCount: userId
        ? this.store.activeWarnCount(guild.id, userId)
        : null,
    };
  }

  async publishCase(bot: Bot, entry: ModCase) {
    const client = this.connections.get(bot.slug)?.client;
    if (!client) return;
    try {
      const guild = await client.guilds.fetch(entry.guild_id);
      await publishModeration(
        {
          store: this.store,
          bot,
          client,
          guild,
          config: {},
          enabledFeatures: [],
          intents: gatewaySettings.parse(bot).intents,
          active: () => true,
          logger: (message) =>
            this.store.audit({
              timestamp: new Date().toISOString(),
              key: entry.actor,
              bot,
              tool: 'moderation_log',
              target: entry.guild_id,
              result: message,
            }),
        },
        { ...entry },
      );
    } catch {
      /* The action and case succeeded even when gateway logging is unavailable. */
    }
  }

  async warnMember(
    bot: Bot,
    guildId: string,
    memberId: string,
    reason: string,
    label: string,
  ) {
    await this.resolveGuilds(bot, guildId);
    const shared = this.store.moduleInstance(bot.id, guildId, 'moderation');
    const client = this.connections.get(bot.slug)?.client;
    if (shared.enabled && !client)
      throw new Error('Moderation requires a connected Discord client.');
    const guild = shared.enabled ? await client!.guilds.fetch(guildId) : null;
    const member = guild ? await guild.members.fetch(memberId) : null;
    const config = moderationModule.configSchema.parse(shared.config);
    if (guild && member) {
      const me = guild.members.me ?? (await guild.members.fetchMe());
      if (!me.permissions.has(PermissionFlagsBits.ModerateMembers))
        throw new Error(
          'The bot is missing the required moderation permission.',
        );
      if (
        member.id === guild.ownerId ||
        me.roles.highest.comparePositionTo(member.roles.highest) <= 0
      )
        throw new Error(
          'The bot cannot moderate this member because of role hierarchy.',
        );
    }
    const entry = this.store.createCase({
      bot_id: bot.id,
      guild_id: guildId,
      user_id: memberId,
      actor: `agent:${label}`,
      action: 'warn',
      reason,
    });
    const count = this.store.activeWarnCount(guildId, memberId);
    if (!shared.enabled) {
      await this.publishCase(bot, entry);
      return {
        case: entry,
        message:
          'Warning recorded. Moderation is disabled in this server; no DM or escalation processing occurred.',
      };
    }
    const ctx = {
      store: this.store,
      bot,
      client: client!,
      guild: guild!,
      config,
      enabledFeatures: [],
      intents: gatewaySettings.parse(bot).intents,
      active: () =>
        this.store.moduleInstance(bot.id, guildId, 'moderation').enabled,
      logger: (message: string) =>
        this.store.audit({
          timestamp: new Date().toISOString(),
          key: `agent:${label}`,
          bot,
          tool: 'warn_member',
          target: `${guildId}:${memberId}`,
          result: message,
        }),
    };
    await notify(ctx, entry, member!.user, config);
    await escalate(ctx, member, config, count);
    return {
      case: entry,
      message: `Case #${entry.case_number}: warn recorded.`,
    };
  }

  async recordAgentModeration(
    bot: Bot,
    name: string,
    args: Record<string, unknown>,
    label: string,
  ) {
    const actions: Record<string, ModAction> = {
      ban_member: 'ban',
      kick_member: 'kick',
      timeout_member: args.duration === null ? 'untimeout' : 'timeout',
      moderation_ban: 'ban',
      moderation_unban: 'unban',
      moderation_kick: 'kick',
      moderation_timeout: args.until === null ? 'untimeout' : 'timeout',
    };
    const action = actions[name];
    if (!action) return;
    const entry = this.store.createCase({
      bot_id: bot.id,
      guild_id: String(args.guild_id),
      user_id: String(args.member ?? args.user_id),
      actor: `agent:${label}`,
      action,
      reason:
        typeof args.reason === 'string'
          ? args.reason
          : 'Agent moderation action',
      expires_at:
        action === 'timeout'
          ? name === 'timeout_member'
            ? new Date(
                Date.now() + duration(String(args.duration)),
              ).toISOString()
            : String(args.until)
          : null,
    });
    await this.publishCase(bot, entry);
  }

  featureStates(bot: Bot, guildId: string) {
    const instances = this.store.featureInstances(bot.id, guildId);
    return features.map((feature) => {
      const instance = instances.find((i) => i.featureId === feature.id);
      const shared = this.store.moduleInstance(bot.id, guildId, feature.module);
      const requiredIntents = [...feature.requiredIntents];
      if (
        feature.id.startsWith('logging.message') &&
        shared.config.includeContent !== false
      )
        requiredIntents.push('MessageContent');
      const missingIntents = requiredIntents.filter(
        (i) => !gatewaySettings.parse(bot).intents.includes(i),
      );
      const module = this.store.moduleInstance(bot.id, guildId, feature.module);
      const config = { ...shared.config, ...instance?.config };
      const action =
        config.action && config.action !== 'inherit'
          ? config.action
          : (config.defaultAction ?? 'delete');
      const requiredPermissions =
        feature.module === 'automod'
          ? [
              ...(action === 'delete' || action === 'delete_and_warn'
                ? ['ManageMessages' as const]
                : []),
              ...(action === 'warn' ||
              action === 'delete_and_warn' ||
              action === 'timeout'
                ? ['ModerateMembers' as const]
                : []),
              ...(action === 'kick' ? ['KickMembers' as const] : []),
            ]
          : feature.module === 'moderation'
            ? (['BanMembers', 'KickMembers', 'ModerateMembers'] as const)
            : [];
      const me = this.connections
        .get(bot.slug)
        ?.client?.guilds?.cache?.get(guildId)?.members.me;
      const missingPermissions = me
        ? requiredPermissions.filter(
            (p) =>
              !me.permissions.has(
                PermissionFlagsBits[p as keyof typeof PermissionFlagsBits],
              ),
          )
        : [];
      return {
        module: feature.module,
        label: feature.label,
        fields: feature.fields,
        effectiveEnabled: module.enabled && (instance?.enabled ?? false),
        moduleEnabled: module.enabled,
        botId: bot.id,
        guildId,
        featureId: feature.id,
        name: feature.name,
        description: feature.description,
        configSchema: z.toJSONSchema(feature.configSchema),
        enabled: instance?.enabled ?? false,
        config: instance?.config ?? null,
        missingIntents,
        missingPermissions,
        state: !instance?.enabled
          ? 'disabled'
          : !module.enabled
            ? 'suspended'
            : missingIntents.length || missingPermissions.length
              ? 'degraded'
              : 'enabled',
      };
    });
  }

  moduleStates(bot: Bot, guildId: string) {
    const states = this.featureStates(bot, guildId);
    return modules.map((module) => ({
      ...this.store.moduleInstance(bot.id, guildId, module.id),
      id: module.id,
      label: module.label,
      description: module.description,
      fields: module.fields,
      configSchema: z.toJSONSchema(module.configSchema),
      features: states.filter((f) => f.module === module.id),
    }));
  }

  async configureModule(
    bot: Bot,
    address: string,
    moduleId: string,
    patch?: Record<string, unknown>,
    enabled?: boolean,
  ) {
    const module = modules.find((m) => m.id === moduleId);
    if (!module) throw new Error('Unknown module.');
    const guilds = await this.resolveGuilds(bot, address);
    const instances = guilds.map((guild) => {
      const old = this.store.moduleInstance(bot.id, guild.id, moduleId);
      const merged = { ...old.config, ...patch };
      const config = patch
        ? {
            ...merged,
            ...parseConfig(module.configSchema, module.fields, merged),
          }
        : old.config;
      return { ...old, config, enabled: enabled ?? old.enabled };
    });
    this.store.saveModuleInstances(instances);
    return instances;
  }

  private readonly resourceCache = new Map<
    string,
    { expires: number; value: unknown }
  >();
  async guildResources(bot: Bot, guildId: string, kind: 'channels' | 'roles') {
    const client = this.connections.get(bot.slug)?.client;
    if (!client?.isReady())
      throw new Error('Connect the bot to load server choices.');
    const key = `${bot.id}:${guildId}:${kind}`;
    const cached = this.resourceCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const guild = await client.guilds.fetch(guildId);
    const value =
      kind === 'channels'
        ? [...(await guild.channels.fetch()).values()]
            .filter((c) => c !== null)
            .map((c) => ({ id: c.id, name: c.name, type: c.type }))
        : [...(await guild.roles.fetch()).values()].map((r) => ({
            id: r.id,
            name: r.name,
            color: r.hexColor,
          }));
    this.resourceCache.set(key, { expires: Date.now() + 15000, value });
    return value;
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
      if (enabled === true) {
        const module = modules.find((m) => m.id === feature.module)!;
        parseConfig(
          module.configSchema,
          module.fields,
          this.store.moduleInstance(bot.id, guild.id, module.id).config,
        );
      }
      const old = this.store
        .featureInstances(bot.id, guild.id)
        .find((i) => i.featureId === featureId);
      if (!old && enabled === false) return [];
      const config =
        enabled === false && !patch
          ? (old?.config ?? {})
          : {
              ...old?.config,
              ...patch,
              ...parseConfig(feature.configSchema, feature.fields, {
                ...old?.config,
                ...patch,
              }),
            };
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
