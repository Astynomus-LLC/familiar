import type { FeatureContext } from './types.js';
import type { ModCase, NewCase } from '../storage/cases.js';
import { logModeration } from './logging.js';

export async function publishModeration(
  ctx: FeatureContext,
  event: Record<string, unknown>,
) {
  ctx.store?.emit('moderationAction', {
    botId: ctx.bot?.id,
    guildId: ctx.guild.id,
    ...event,
  });
  try {
    await logModeration(ctx, event);
  } catch {
    ctx.logger('Moderation log delivery failed.');
  }
}
export function recordCase(
  ctx: FeatureContext,
  input: Omit<NewCase, 'bot_id' | 'guild_id'>,
): ModCase {
  if (!ctx.store || !ctx.bot) throw new Error('Case store unavailable.');
  const entry = ctx.store.createCase({
    ...input,
    bot_id: ctx.bot.id,
    guild_id: ctx.guild.id,
  });
  ctx.store.audit({
    timestamp: entry.created_at,
    key: input.actor,
    bot: ctx.bot,
    tool: input.action,
    target: `${ctx.guild.id}:${input.user_id}`,
    result: `success: case #${entry.case_number}`,
  });
  return entry;
}
export { caseEmbed } from './presentation.js';
export function duration(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  const ms = match
    ? Number(match[1]) *
      ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]] ?? 0)
    : 0;
  if (!ms || ms > 28 * 86400000)
    throw new Error('Duration must be 1s–28d, for example 30m or 1h.');
  return ms;
}
