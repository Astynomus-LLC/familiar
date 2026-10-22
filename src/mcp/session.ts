import { z } from 'zod';
import { Confirmations } from './confirmations.js';
import type { ApiKey, Bot, Store } from '../storage/store.js';
import type { BotManager } from '../bots/manager.js';
import { alwaysOn, categories } from '../tools/registry.js';
import { flag, type Tool } from '../tools/types.js';

export class Session {
  private readonly confirmations = new Confirmations();
  private active?: string;
  private closed = false;
  private readonly onChange: () => void;
  private readonly onRevoke: (id: string) => void;

  constructor(
    readonly store: Store,
    readonly manager: BotManager,
    readonly keyId?: string,
    private readonly notify: () => void = () => {},
    private readonly disconnect: () => void = () => {},
  ) {
    this.onChange = () => {
      if (!this.closed) this.notify();
    };
    this.onRevoke = (id) => {
      if (id === keyId) {
        this.close();
        this.disconnect();
      }
    };
    store.on('toolsChanged', this.onChange);
    store.on('keyRevoked', this.onRevoke);
  }

  key(): ApiKey | undefined {
    if (this.closed) throw new Error('Session closed.');
    const key = this.keyId
      ? this.store.keys().find((item) => item.id === this.keyId)
      : undefined;
    if (this.keyId && !key) throw new Error('Session closed.');
    return key;
  }

  bots(): Bot[] {
    const key = this.key();
    return this.store
      .bots()
      .filter((bot) => !key?.bots || key.bots.includes(bot.slug));
  }

  resolve(override?: string): Bot {
    const bots = this.bots();
    const slug =
      override ?? this.active ?? this.store.setting<string>('defaultBot');
    const bot = bots.find((item) => item.slug === slug);
    if (bot) return bot;
    if (!override && bots.length) return bots[0];
    throw new Error('Bot not found.');
  }

  setActive(slug: string): void {
    const bot = this.resolve(slug);
    this.active = bot.slug;
    this.notify();
  }

  private available(bot: Bot): Tool[] {
    const key = this.key();
    return categories
      .filter(
        (category) =>
          alwaysOn.has(category.name) ||
          (bot.categories.includes(category.name) &&
            (!key?.categories || key.categories.includes(category.name))),
      )
      .flatMap((category) => category.tools)
      .filter(
        (tool) =>
          !(this.store.setting<boolean>('readOnly') || key?.readOnly) ||
          tool.mutating !== true,
      );
  }

  list(): unknown[] {
    let tools: Tool[];
    try {
      tools = this.available(this.resolve());
    } catch {
      tools = this.keyId
        ? []
        : categories
            .filter((category) => alwaysOn.has(category.name))
            .flatMap((category) => category.tools);
    }
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(
        tool.schema.extend({
          bot: z.string().optional(),
          confirmation: z.string().optional(),
        }),
      ),
      annotations: {
        readOnlyHint: tool.mutating === false,
        destructiveHint: Boolean(tool.destructive),
      },
    }));
  }

  async call(
    name: string,
    input: Record<string, unknown>,
  ): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
    let bot: Bot | undefined;
    let mutating = false;
    let outcome = 'rejected';
    let keyLabel = 'stdio';
    let target = '';
    try {
      const key = this.key();
      keyLabel = key?.label ?? 'stdio';
      z.object({
        bot: z.string().optional(),
        confirmation: z.string().optional(),
      }).parse(input);
      if (name === 'list_bots' && !input.bot && this.bots().length === 0)
        return this.result(undefined, []);
      bot = this.resolve(typeof input.bot === 'string' ? input.bot : undefined);
      const tool = categories
        .flatMap((category) => category.tools)
        .find((item) => item.name === name);
      if (!tool) throw new Error('Tool not found.');
      mutating = flag(tool.mutating, input);
      const args = tool.schema.parse(input);
      target = Object.entries(args)
        .filter(
          ([name]) =>
            name.endsWith('_id') ||
            name === 'path' ||
            name === 'code' ||
            name === 'guild',
        )
        .map(
          ([name, value]) =>
            `${name}=${
              name === 'path'
                ? String(value)
                    .split('?')[0]
                    .replace(
                      /(\/(?:webhooks|interactions)\/[^/]+\/)[^/]+/,
                      '$1[redacted]',
                    )
                : value
            }`,
        )
        .join(', ');
      if (mutating && (key?.readOnly || this.store.setting('readOnly')))
        throw new Error('Read-only mode is enabled.');
      if (!this.available(bot).includes(tool))
        throw new Error('Tool not found.');
      if (
        name === 'api_request' &&
        key?.categories &&
        !key.categories.includes('raw_api')
      )
        throw new Error('Raw API is outside this key’s category ceiling.');
      if (flag(tool.destructive, args)) {
        const pending = this.confirmations.check(
          `${bot.slug}:${bot.id}`,
          name,
          args,
          typeof input.confirmation === 'string'
            ? input.confirmation
            : undefined,
        );
        if (pending) {
          outcome = 'confirmation_required';
          return this.result(bot, {
            confirmation_required: true,
            ...pending,
            action: name,
            target,
            message: `Repeat ${name} for ${target} as ${bot.name} (${bot.slug}) with confirmation: ${pending.code}.`,
          });
        }
      }
      outcome = 'failed';
      const result = await tool.execute(
        {
          bot,
          bots: this.bots(),
          manager: this.manager,
          setActiveBot: (slug) => this.setActive(slug),
        },
        args,
      );
      await this.manager.recordAgentModeration(bot, name, args, keyLabel);
      if (name === 'set_active_bot') bot = this.resolve();
      outcome = 'success';
      return this.result(bot, result);
    } catch (error) {
      return {
        ...this.result(bot, {
          error: error instanceof Error ? error.message : 'Tool failed.',
        }),
        isError: true,
      };
    } finally {
      if (mutating && bot)
        this.store.audit({
          timestamp: new Date().toISOString(),
          key: keyLabel,
          bot: { slug: bot.slug, name: bot.name },
          tool: name,
          target,
          result: outcome,
        });
    }
  }

  private result(bot: Bot | undefined, result: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            bot: bot ? { slug: bot.slug, name: bot.name } : null,
            result,
          }),
        },
      ],
    };
  }

  close(): void {
    this.closed = true;
    this.store.off('toolsChanged', this.onChange);
    this.store.off('keyRevoked', this.onRevoke);
  }
}
