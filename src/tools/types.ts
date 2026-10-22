import type { ZodObject, ZodRawShape } from 'zod';
import type { Bot } from '../storage/store.js';
import type { BotManager, Method } from '../bots/manager.js';

export interface ToolContext {
  bot: Bot;
  bots: Bot[];
  manager: BotManager;
  setActiveBot(slug: string): void;
}

export interface Tool {
  name: string;
  description: string;
  schema: ZodObject<ZodRawShape>;
  mutating: boolean | ((args: Record<string, unknown>) => boolean);
  destructive?: boolean | ((args: Record<string, unknown>) => boolean);
  execute(
    context: ToolContext,
    args: Record<string, unknown>,
  ): Promise<unknown> | unknown;
}

export interface Category {
  name: string;
  description: string;
  tools: Tool[];
}

export interface RestToolOptions {
  name: string;
  description: string;
  method: Method;
  path: (args: Record<string, unknown>) => string;
  schema: ZodObject<ZodRawShape>;
  body?: (args: Record<string, unknown>) => unknown;
  destructive?: boolean;
}

export function restTool(options: RestToolOptions): Tool {
  return {
    name: options.name,
    description: options.description,
    schema: options.schema,
    mutating: options.method !== 'GET',
    destructive: options.destructive,
    execute: ({ bot, manager }, args) =>
      manager.request(
        bot,
        options.method,
        options.path(args),
        options.body?.(args),
      ),
  };
}

export function flag(
  value: Tool['mutating'] | undefined,
  args: Record<string, unknown>,
): boolean {
  return typeof value === 'function' ? value(args) : Boolean(value);
}
