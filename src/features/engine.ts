/* eslint-disable @typescript-eslint/no-explicit-any -- Discord event tuples have different payload shapes; the registry is the dynamic dispatch boundary. */
import type { Client, Guild } from 'discord.js';
import type { Bot, Store } from '../storage/store.js';
import { routeComponent, refreshCase } from './components.js';
import { features } from './registry.js';
import {
  gatewaySettings,
  type FeatureInstance,
  type FeatureContext,
  type Feature,
} from './types.js';
export class FeatureEngine {
  private readonly listeners: [string, (...args: any[]) => void][] = [];
  private closed = false;
  private queue = Promise.resolve();
  private componentQueue = Promise.resolve();
  constructor(
    private store: Store,
    private bot: Bot,
    private client: Client,
    private registry: Feature[] = features,
  ) {
    for (const name of new Set([
      ...registry.flatMap((f) => f.events.map((e) => e.name)),
      'interactionCreate',
      'messageCreate',
    ])) {
      const listener = (...args: any[]) => {
        void this.dispatch(name, ...args).catch(() =>
          console.error(`Bot ${this.bot.slug}: feature dispatch failed.`),
        );
      };
      client.on(name, listener);
      this.listeners.push([name, listener]);
    }
    client.on('clientReady', this.sync);
    client.on('guildCreate', this.sync);
    store.on('featuresChanged', this.changed);
    store.on('caseChanged', this.caseChanged);
  }
  private caseChanged = (entry: { guild_id: string; case_number: number }) => {
    const guild = this.client.guilds?.cache.get(entry.guild_id);
    if (this.closed || !guild) return;
    const ctx = this.context(
      {
        botId: this.bot.id,
        guildId: guild.id,
        featureId: 'moderation.commands',
        enabled: true,
        config: {},
      },
      guild,
    );
    void refreshCase(ctx, entry.case_number).catch(() => {
      if (!this.closed) ctx.logger('Case panel refresh failed.');
    });
  };
  private changed = (instance: FeatureInstance) => {
    if (instance.botId === this.bot.id) this.sync();
  };
  private sync = () => {
    this.queue = this.queue
      .then(() => this.syncCommands())
      .catch(() =>
        console.error(
          `Bot ${this.bot.slug}: feature command synchronization failed.`,
        ),
      );
  };
  private module(instance: FeatureInstance) {
    const feature = this.registry.find((f) => f.id === instance.featureId);
    return this.store.moduleInstance(
      instance.botId,
      instance.guildId,
      feature?.module ?? '',
    );
  }
  private context(instance: FeatureInstance, guild: Guild): FeatureContext {
    const module = this.module(instance);

    return {
      store: this.store,
      bot: this.bot,
      client: this.client,
      guild,
      config: { ...module.config, ...instance.config },
      enabledFeatures: this.store
        .featureInstances(instance.botId, instance.guildId)
        .filter((i) => i.enabled && this.module(i).enabled)
        .map((i) => i.featureId),
      intents: gatewaySettings.parse(this.bot).intents,
      logger: (message) => {
        this.store.audit({
          timestamp: new Date().toISOString(),
          key: `feature:${instance.featureId}`,
          bot: this.bot,
          tool: instance.featureId,
          target: guild.id,
          result: message,
        });
        console.error(
          `Bot ${this.bot.slug}, guild ${guild.id}, feature ${instance.featureId}: ${message}`,
        );
      },
      active: () =>
        !this.closed &&
        this.module(instance).enabled &&
        JSON.stringify(this.module(instance).config) ===
          JSON.stringify(module.config) &&
        this.store
          .featureInstances(this.bot.id, guild.id)
          .some(
            (i) =>
              i.featureId === instance.featureId &&
              i.enabled &&
              JSON.stringify(i.config) === JSON.stringify(instance.config),
          ),
    };
  }
  async dispatch(name: string, ...args: any[]): Promise<void> {
    if (this.closed) return;
    const guild = args.find((arg) => arg?.guild)?.guild as Guild | undefined;
    if (!guild) return;
    if (name === 'interactionCreate' && args[0].customId?.startsWith('fam:')) {
      const ctx = this.context(
        {
          botId: this.bot.id,
          guildId: guild.id,
          featureId: 'moderation.commands',
          enabled: true,
          config: {},
        },
        guild,
      );
      this.componentQueue = this.componentQueue
        .then(() => routeComponent(ctx, args[0]))
        .catch(async () => {
          ctx.logger('Component action failed.');
          const i = args[0];
          const body = {
            content:
              'Unable to complete this action. Check permissions and role hierarchy, then try again.',
            components: [],
          };
          if (i.deferred || i.replied) await i.editReply(body).catch(() => {});
          else await i.reply({ ...body, ephemeral: true }).catch(() => {});
        });
      await this.componentQueue;
      return;
    }
    const intents = gatewaySettings.parse(this.bot).intents;
    await Promise.all(
      this.store
        .featureInstances(this.bot.id, guild.id)
        .filter((i) => i.enabled && this.module(i).enabled)
        .map(async (instance) => {
          const feature = this.registry.find(
            (f) => f.id === instance.featureId,
          );
          if (!feature) return;
          const ctx = this.context(instance, guild);
          try {
            for (const event of feature.events)
              if (
                event.name === name &&
                event.intents.every((i) => intents.includes(i))
              )
                await event.handle(ctx, ...args);
            if (
              name === 'interactionCreate' &&
              args[0].isChatInputCommand?.()
            ) {
              const owned =
                this.store.setting<
                  Record<string, { id: string; feature: string }>
                >(`featureCommands:${this.bot.id}:${guild.id}`) ?? {};
              const command = feature.slashCommands?.find(
                (c) =>
                  c.name === args[0].commandName &&
                  owned[c.name]?.feature === feature.id &&
                  owned[c.name]?.id === args[0].commandId,
              );
              if (
                command &&
                feature.requiredIntents.every((i) => intents.includes(i))
              )
                await command.handle(ctx, args[0]);
            }
            if (
              name === 'messageCreate' &&
              intents.includes('GuildMessages') &&
              intents.includes('MessageContent') &&
              !args[0].author?.bot
            ) {
              const command = feature.messageCommands?.find(
                (c) => args[0].content?.split(/\s/)[0] === c.name,
              );
              if (
                command &&
                feature.requiredIntents.every((i) => intents.includes(i))
              )
                await command.handle(ctx, args[0]);
            }
          } catch {
            ctx.logger(
              'Handler failed. Check configuration and Discord permissions.',
            );
          }
        }),
    );
  }
  private async syncCommands() {
    if (this.closed || !this.client.isReady()) return;
    for (const guild of this.client.guilds.cache.values()) {
      const key = `featureCommands:${this.bot.id}:${guild.id}`;
      const owned =
        this.store.setting<Record<string, { id: string; feature: string }>>(
          key,
        ) ?? {};
      const enabled = this.store
        .featureInstances(this.bot.id, guild.id)
        .filter((i) => i.enabled && this.module(i).enabled);
      const desired = this.registry
        .filter((f) => enabled.some((i) => i.featureId === f.id))
        .flatMap((f) =>
          (f.slashCommands ?? []).map((c) => ({ ...c, feature: f.id })),
        );
      if (!desired.length && !Object.keys(owned).length) continue;
      const existing = await guild.commands.fetch();
      for (const [name, command] of Object.entries(owned)) {
        if (
          !desired.some((c) => c.name === name && c.feature === command.feature)
        ) {
          if (existing.has(command.id)) await guild.commands.delete(command.id);
          delete owned[name];
          this.store.setSetting(key, owned);
        }
      }
      for (const command of desired) {
        if (owned[command.name] && existing.has(owned[command.name].id))
          continue;
        if (existing.some((c) => c.name === command.name)) {
          console.error(`Feature command name collision: ${command.name}`);
          continue;
        }
        const created = await guild.commands.create({
          name: command.name,
          description: command.description,
          options: command.options,
          defaultMemberPermissions: command.defaultMemberPermissions,
        });
        owned[command.name] = { id: created.id, feature: command.feature };
        this.store.setSetting(key, owned);
      }
    }
  }
  close() {
    this.closed = true;
    for (const [name, listener] of this.listeners)
      this.client.off(name, listener);
    this.client.off('clientReady', this.sync);
    this.client.off('guildCreate', this.sync);
    this.store.off('featuresChanged', this.changed);
    this.store.off('caseChanged', this.caseChanged);
  }
}
