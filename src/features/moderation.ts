/* eslint-disable @typescript-eslint/no-explicit-any -- Discord interaction payload boundary. */
import { z } from 'zod';
import {
  ApplicationCommandOptionType as O,
  PermissionFlagsBits as P,
} from 'discord.js';
import {
  snowflake,
  type Feature,
  type FeatureContext,
  type Module,
} from './types.js';
import {
  caseEmbed,
  duration,
  publishModeration,
  recordCase,
} from './moderation-service.js';
import type { ModAction, ModCase } from '../storage/cases.js';
const threshold = z.object({
  count: z.number().int().min(1),
  action: z.enum(['timeout', 'kick']),
  duration: z.string().default('1h'),
});
export const moderationModule: Module = {
  id: 'moderation',
  label: 'Moderation',
  description: 'Moderation commands and this server’s case history.',
  configSchema: z.object({
    modRoles: z.array(snowflake).default([]),
    dmSubject: z.boolean().default(true),
    announceChannel: z.union([snowflake, z.literal('')]).default(''),
    thresholds: z
      .array(threshold)
      .default([])
      .refine(
        (rows) =>
          rows.every((row) => {
            try {
              if (row.action === 'timeout') duration(row.duration);
              return true;
            } catch {
              return false;
            }
          }) && new Set(rows.map((r) => r.count)).size === rows.length,
        'Use unique counts and valid timeout durations.',
      ),
  }),
  fields: {
    modRoles: {
      type: 'roles',
      label: 'Moderator roles',
      help: 'Also allow these roles at runtime. Discord command visibility can be adjusted in Server Settings → Integrations.',
    },
    dmSubject: {
      type: 'toggle',
      label: 'DM subjects',
      help: 'Send the server name and reason. Closed DMs do not fail actions.',
    },
    announceChannel: {
      type: 'channel',
      label: 'Announcement channel',
      help: 'Optional case announcements.',
    },
    thresholds: {
      type: 'thresholds',
      label: 'Warn escalation',
      help: 'Each threshold runs when the active warn count reaches that number.',
    },
  },
};
const permissions: Record<string, bigint> = {
  ban: P.BanMembers,
  unban: P.BanMembers,
  kick: P.KickMembers,
  warn: P.ModerateMembers,
  timeout: P.ModerateMembers,
  untimeout: P.ModerateMembers,
  modlogs: P.ModerateMembers,
  case: P.ModerateMembers,
  voidcase: P.ModerateMembers,
};
function allowed(i: any, config: any, name: string): boolean {
  return Boolean(
    i.memberPermissions?.has(permissions[name]) ||
    config.modRoles.some(
      (id: string) =>
        i.member?.roles?.cache?.has(id) || i.member?.roles?.includes?.(id),
    ),
  );
}
async function notify(
  ctx: FeatureContext,
  entry: ModCase,
  user: any,
  config: any,
) {
  await publishModeration(ctx, { ...entry });
  if (config.dmSubject && user) {
    try {
      await user.send({
        content: `${ctx.guild.name}: ${entry.action} — ${entry.reason}`,
        allowedMentions: { parse: [] },
      });
    } catch {
      /* DMs are best effort. */
    }
  }
  if (config.announceChannel) {
    try {
      const channel = await ctx.guild.channels.fetch(config.announceChannel);
      if (channel?.isTextBased() && 'send' in channel)
        await channel.send({
          embeds: [caseEmbed(entry)],
          allowedMentions: { parse: [] },
        });
    } catch {
      ctx.logger('Case announcement delivery failed.');
    }
  }
}
async function checkHierarchy(
  ctx: FeatureContext,
  i: any,
  member: any,
  action: string,
) {
  const me = ctx.guild.members.me ?? (await ctx.guild.members.fetchMe());
  if (!me.permissions.has(permissions[action]))
    throw new Error('The bot is missing the required moderation permission.');
  if (!member) return;
  if (
    member.id === ctx.guild.ownerId ||
    member.id === i.user.id ||
    me.roles.highest.comparePositionTo(member.roles.highest) <= 0
  )
    throw new Error(
      'The bot cannot moderate this member because of role hierarchy.',
    );
  const invoker = await ctx.guild.members.fetch(i.user.id);
  if (
    i.user.id !== ctx.guild.ownerId &&
    invoker.roles.highest.comparePositionTo(member.roles.highest) <= 0
  )
    throw new Error('Your highest role must be above the subject’s role.');
  if (action === 'timeout' || action === 'untimeout') {
    if (!member.moderatable)
      throw new Error('This member cannot be timed out.');
  }
  if (action === 'kick' && !member.kickable)
    throw new Error('This member cannot be kicked.');
  if (action === 'ban' && !member.bannable)
    throw new Error('This member cannot be banned.');
}
export async function escalate(
  ctx: FeatureContext,
  member: any,
  config: any,
  count: number,
) {
  const rule = config.thresholds.find((r: any) => r.count === count);
  if (!rule || !ctx.active()) return;
  try {
    const reason = `Warn escalation: ${count} active warnings`;
    const ms = rule.action === 'timeout' ? duration(rule.duration) : 0;
    if (rule.action === 'timeout') {
      if (!member.moderatable) throw new Error('Cannot timeout');
      await member.timeout(ms, reason);
    } else {
      if (!member.kickable) throw new Error('Cannot kick');
      await member.kick(reason);
    }
    const entry = recordCase(ctx, {
      user_id: member.id,
      actor: 'system:warn-escalation',
      action: rule.action,
      reason,
      expires_at: ms ? new Date(Date.now() + ms).toISOString() : null,
    });
    await notify(ctx, entry, member.user, config);
  } catch {
    ctx.logger(
      'Warn escalation failed. Check role hierarchy and Discord permissions.',
    );
  }
}
async function history(
  ctx: FeatureContext,
  i: any,
  userId: string,
  config: any,
) {
  let before = Number.MAX_SAFE_INTEGER;
  const page = () => {
    const rows = ctx.store!.modCases(ctx.guild.id, userId, before, 6);
    const shown = rows.slice(0, 5);
    return {
      body: {
        content: `Server history for <@${userId}> · ${ctx.store!.activeWarnCount(ctx.guild.id, userId)} active warnings`,
        embeds: shown.map(caseEmbed),
        components:
          rows.length > 5
            ? [
                {
                  type: 1,
                  components: [
                    {
                      type: 2,
                      style: 2,
                      label: 'Older cases',
                      custom_id: 'modlogs:older',
                    },
                  ],
                },
              ]
            : [],
        allowedMentions: { parse: [] as never[] },
      },
      next: shown.at(-1)?.case_number,
    };
  };
  let result = page();
  const message = await i.editReply(result.body);
  if (
    !message.createMessageComponentCollector ||
    !result.body.components.length
  )
    return;
  const collector = message.createMessageComponentCollector({
    time: 300000,
    filter: (click: any) =>
      click.user.id === i.user.id && click.customId === 'modlogs:older',
  });
  collector.on('collect', (click: any) => {
    void (async () => {
      if (!ctx.active() || !allowed(click, config, 'modlogs')) {
        await click.reply({
          content: 'Moderation access is no longer available.',
          ephemeral: true,
        });
        return;
      }
      before = result.next ?? 0;
      result = page();
      await click.update(result.body);
    })().catch(() => ctx.logger('Case pagination failed.'));
  });
  collector.on('end', () => {
    void i.editReply({ components: [] }).catch(() => {});
  });
}
const userOption = {
  type: O.User as const,
  name: 'member',
  description: 'Subject member',
  required: true,
};
const reasonOption = {
  type: O.String as const,
  name: 'reason',
  description: 'Reason for this action',
  required: true,
  maxLength: 1000,
};
const caseOption = {
  type: O.Integer as const,
  name: 'case-number',
  description: 'Case number in this server',
  required: true,
  minValue: 1,
};
export const moderationFeature: Feature = {
  id: 'moderation.commands',
  module: 'moderation',
  name: 'Moderation commands',
  label: 'Moderation commands',
  description: 'Register moderation slash commands in this server.',
  configSchema: z.object({}),
  fields: {},
  requiredIntents: ['Guilds'],
  events: [],
  slashCommands: Object.keys(permissions).map((name) => ({
    name,
    description: `${name === 'modlogs' ? 'View moderation history' : name === 'case' ? 'View a case' : name === 'voidcase' ? 'Void a case' : `${name} a member`} in this server`,
    defaultMemberPermissions: permissions[name],
    options:
      name === 'case' || name === 'voidcase'
        ? [caseOption]
        : name === 'unban'
          ? [
              {
                type: O.String,
                name: 'user-id',
                description: 'Banned user ID',
                required: true,
              },
              reasonOption,
            ]
          : name === 'modlogs' || name === 'untimeout'
            ? [userOption]
            : name === 'timeout'
              ? [
                  userOption,
                  {
                    type: O.String,
                    name: 'duration',
                    description:
                      'Duration such as 30m, 1h, or 7d (maximum 28d)',
                    required: true,
                  },
                  reasonOption,
                ]
              : [
                  userOption,
                  reasonOption,
                  ...(name === 'ban'
                    ? [
                        {
                          type: O.Integer as const,
                          name: 'delete-messages',
                          description:
                            'Seconds of message history to delete (0–604800)',
                          minValue: 0,
                          maxValue: 604800,
                        },
                      ]
                    : []),
                ],
    async handle(ctx, i) {
      const config = moderationModule.configSchema.parse(ctx.config);
      if (!allowed(i, config, name)) {
        await i.reply({
          content: 'You do not have permission to use this moderation command.',
          ephemeral: true,
        });
        ctx.logger(`Permission denied: ${name}`);
        return;
      }
      await i.deferReply({ ephemeral: true });
      try {
        if (!ctx.active()) throw new Error('Moderation is disabled.');
        if (name === 'case' || name === 'voidcase') {
          const number = i.options.getInteger('case-number', true);
          const entry =
            name === 'voidcase'
              ? ctx.store!.voidCase(ctx.guild.id, number)
              : ctx.store!.modCase(ctx.guild.id, number);
          if (!entry) throw new Error('Case not found in this server.');
          if (name === 'voidcase') {
            ctx.store!.audit({
              timestamp: new Date().toISOString(),
              key: i.user.id,
              bot: ctx.bot!,
              tool: 'voidcase',
              target: `${ctx.guild.id}:${number}`,
              result: 'success',
            });
            await publishModeration(ctx, { ...entry, action: 'voidcase' });
          }
          await i.editReply({ embeds: [caseEmbed(entry)] });
          return;
        }
        const user =
          name === 'unban' ? null : i.options.getUser('member', true);
        const userId =
          user?.id ?? snowflake.parse(i.options.getString('user-id', true));
        if (name === 'modlogs') {
          await history(ctx, i, userId, config);
          return;
        }
        const member =
          name === 'unban' ? null : await ctx.guild.members.fetch(userId);
        const reason =
          name === 'untimeout'
            ? 'Timeout removed by moderator'
            : i.options.getString('reason', true);
        const ms =
          name === 'timeout'
            ? duration(i.options.getString('duration', true))
            : 0;
        await checkHierarchy(ctx, i, member, name);
        if (!ctx.active()) throw new Error('Moderation is disabled.');
        if (name === 'ban')
          await member!.ban({
            reason,
            deleteMessageSeconds: i.options.getInteger('delete-messages') ?? 0,
          });
        if (name === 'kick') await member!.kick(reason);
        if (name === 'unban') await ctx.guild.members.unban(userId, reason);
        if (name === 'timeout' || name === 'untimeout')
          await member!.timeout(ms || null, reason);
        const entry = recordCase(ctx, {
          user_id: userId,
          actor: i.user.id,
          action: name as ModAction,
          reason,
          expires_at: ms ? new Date(Date.now() + ms).toISOString() : null,
        });
        const warnCount =
          name === 'warn'
            ? ctx.store!.activeWarnCount(ctx.guild.id, userId)
            : 0;
        await notify(
          ctx,
          entry,
          user ?? (await ctx.client.users.fetch(userId).catch(() => null)),
          config,
        );
        await i.editReply({
          content: `Case #${entry.case_number}: ${name} recorded.`,
          allowedMentions: { parse: [] },
        });
        if (name === 'warn') await escalate(ctx, member, config, warnCount);
      } catch (error) {
        ctx.logger(
          `Moderation command failed: ${name}. Check hierarchy and permissions.`,
        );
        await i.editReply({
          content:
            error instanceof Error && !('code' in error)
              ? error.message
              : 'Discord rejected the action. Check the bot’s permissions and role hierarchy. No case was recorded.',
          allowedMentions: { parse: [] },
        });
      }
    },
  })),
};
