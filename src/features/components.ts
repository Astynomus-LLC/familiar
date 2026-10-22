/* eslint-disable @typescript-eslint/no-explicit-any -- Discord component boundary. */
import { randomBytes } from 'node:crypto';
import { PermissionFlagsBits as P, Routes } from 'discord.js';
import type { FeatureContext } from './types.js';
import type { ModCase } from '../storage/cases.js';
import { caseEmbed, embed } from './presentation.js';
import { checkHierarchy, notify, moderationModule } from './moderation.js';
import { recordCase } from './moderation-service.js';
interface Panel {
  kind: 'case' | 'history';
  user?: string;
  invoker?: string;
  number?: number;
  expires?: number;
  channel?: string;
  message?: string;
  token?: string;
  application?: string;
}
const key = (ctx: FeatureContext, id: string) =>
  `panel:${ctx.bot!.id}:${ctx.guild.id}:${id}`;
const idFor = (id: string, action: string, extra = '') =>
  `fam:mod:${action}:${id}${extra ? `.${extra}` : ''}`;
const button = (
  id: string,
  action: string,
  label: string,
  disabled = false,
  extra = '',
) => ({
  type: 2 as const,
  style: 2 as const,
  label,
  custom_id: idFor(id, action, extra),
  disabled,
});
const row = (components: any[]) => ({ type: 1 as const, components });
export function createPanel(ctx: FeatureContext, panel: Panel) {
  const id = BigInt(`0x${randomBytes(8).toString('hex')}`).toString();
  ctx.store!.setSetting(key(ctx, id), panel);
  if (panel.number) {
    const ref = `casePanels:${ctx.bot!.id}:${ctx.guild.id}:${panel.number}`;
    ctx.store!.setSetting(ref, [
      ...(ctx.store!.setting<string[]>(ref) ?? []),
      id,
    ]);
  }
  return id;
}
export function caseBody(ctx: FeatureContext, entry: ModCase, id: string) {
  return {
    embeds: [caseEmbed(entry, ctx)],
    components: entry.active
      ? [
          row([
            button(id, 'void', 'Void case'),
            ...(entry.actor.startsWith('automod:') &&
            !entry.metadata.timeoutCase
              ? [button(id, 'timeout', 'Timeout member')]
              : []),
          ]),
        ]
      : [],
    allowedMentions: { parse: [] as never[] },
  };
}
export async function sendCase(
  ctx: FeatureContext,
  entry: ModCase,
  channel: any,
) {
  await ctx.client.users.fetch(entry.user_id).catch(() => null);
  const panel: Panel = {
    kind: 'case',
    number: entry.case_number,
    channel: channel.id,
  };
  const id = createPanel(ctx, panel);
  const message = await channel.send(caseBody(ctx, entry, id));
  if (message?.id)
    ctx.store!.setSetting(key(ctx, id), {
      ...panel,
      channel: message.channelId ?? channel.id,
      message: message.id,
    });
}
export async function replyCase(
  ctx: FeatureContext,
  entry: ModCase,
  i: any,
  content?: string,
) {
  await ctx.client.users.fetch(entry.user_id).catch(() => null);
  const id = createPanel(ctx, {
    kind: 'case',
    number: entry.case_number,
    expires: Date.now() + 900000,
    token: i.token,
    application: i.applicationId,
    message: '@original',
  });
  await i.editReply({ ...caseBody(ctx, entry, id), content });
}
const filters = ['All', 'Warns', 'Kicks', 'Bans', 'Timeouts', 'Automod'];
export function historyBody(
  ctx: FeatureContext,
  id: string,
  user: string,
  requested = 0,
  filter = 0,
) {
  const all = ctx
    .store!.modCases(ctx.guild.id, user, Number.MAX_SAFE_INTEGER, -1)
    .filter(
      (e) =>
        filter === 0 ||
        (filter === 5
          ? e.actor.startsWith('automod:') || e.action === 'automod'
          : e.action === ['', 'warn', 'kick', 'ban', 'timeout'][filter]),
    );
  const pages = Math.max(1, Math.ceil(all.length / 5));
  const page = Math.max(0, Math.min(requested, pages - 1));
  const shown = all.slice(page * 5, page * 5 + 5);
  return {
    content: `Server history for <@${user}> · ${all.length} cases · Page ${page + 1}/${pages} · ${ctx.store!.activeWarnCount(ctx.guild.id, user)} active warnings`,
    embeds: shown.length
      ? shown.map((e) => caseEmbed(e, ctx, false, true))
      : [embed('No cases match this filter')],
    components: [
      row([
        button(id, 'page', '◀', page === 0, `${page - 1}.${filter}`),
        button(id, 'page', `${page + 1} / ${pages}`, true, `${page}.${filter}`),
        button(id, 'page', '▶', page === pages - 1, `${page + 1}.${filter}`),
      ]),
      row([
        {
          type: 3,
          custom_id: idFor(id, 'filter'),
          options: filters.map((label, n) => ({
            label,
            value: String(n),
            default: n === filter,
          })),
        },
      ]),
    ],
    allowedMentions: { parse: [] as never[] },
  };
}
export async function refreshCase(ctx: FeatureContext, number: number) {
  const entry = ctx.store!.modCase(ctx.guild.id, number)!;
  await ctx.client.users.fetch(entry.user_id).catch(() => null);
  for (const id of ctx.store!.setting<string[]>(
    `casePanels:${ctx.bot!.id}:${ctx.guild.id}:${number}`,
  ) ?? []) {
    const panel = ctx.store!.setting<Panel>(key(ctx, id));
    if (
      !panel ||
      !panel.message ||
      (panel.expires && Date.now() > panel.expires)
    )
      continue;
    try {
      const body = caseBody(ctx, entry, id);
      if (panel.token && panel.application)
        await ctx.client.rest.patch(
          Routes.webhookMessage(panel.application, panel.token, panel.message),
          { body },
        );
      else {
        const channel: any = await ctx.guild.channels.fetch(panel.channel!);
        await channel.messages.edit(panel.message, body);
      }
    } catch {
      ctx.logger(`Case #${number} panel update failed.`);
    }
  }
}
export async function routeComponent(ctx: FeatureContext, i: any) {
  const match =
    /^fam:mod:(void|confirm|cancel|timeout|duration|page|filter):(\d+)(?:\.(-?\d+))?(?:\.(\d+))?$/.exec(
      i.customId ?? '',
    );
  const deny = (content: string) => i.reply({ content, ephemeral: true });
  if (!match) {
    await deny('This panel is unavailable.');
    return;
  }
  const [, action, id, arg, extra] = match;
  const panel = ctx.store!.setting<Panel>(key(ctx, id));
  if (
    i.message?.flags?.has?.(64) &&
    Date.now() - i.message.createdTimestamp > 900000
  ) {
    await deny('This panel expired — run the command again.');
    return;
  }
  if (!panel || (panel.expires && Date.now() > panel.expires)) {
    await deny('This panel expired — run the command again.');
    return;
  }
  const config = moderationModule.configSchema.parse(
    ctx.store!.moduleInstance(ctx.bot!.id, ctx.guild.id, 'moderation').config,
  );
  const member = await ctx.guild.members
    .fetch({ user: i.user.id, force: true })
    .catch(() => null);
  const history = panel.kind === 'history';
  const authorized =
    member &&
    (member.permissions.has(P.ModerateMembers) ||
      (!history &&
        (config.modRoles as string[]).some((id) =>
          member.roles.cache.has(id),
        )) ||
      (history && i.user.id === panel.invoker));
  if (!authorized) {
    await deny('You do not have permission to use this moderation action.');
    return;
  }
  const audit = () =>
    ctx.store!.audit({
      timestamp: new Date().toISOString(),
      key: i.user.id,
      bot: ctx.bot!,
      tool: `component:${action}`,
      target: `${ctx.guild.id}:${panel.number ?? panel.user}`,
      result: 'success',
    });
  if (history) {
    if (!['page', 'filter'].includes(action)) {
      await deny('Invalid panel action.');
      return;
    }
    const filter = Number(action === 'filter' ? i.values?.[0] : extra);
    if (!Number.isInteger(filter) || filter < 0 || filter > 5) {
      await deny('Invalid filter.');
      return;
    }
    await ctx.client.users.fetch(panel.user!).catch(() => null);
    await i.update(
      historyBody(
        ctx,
        id,
        panel.user!,
        action === 'filter' ? 0 : Number(arg),
        filter,
      ),
    );
    audit();
    return;
  }
  const entry = ctx.store!.modCase(ctx.guild.id, panel.number!);
  if (!entry) {
    await i.update({
      content: 'Case no longer exists.',
      embeds: [],
      components: [],
    });
    audit();
    return;
  }
  if (!entry.active) {
    await i.update({
      content: 'This case is already voided.',
      ...caseBody(ctx, entry, id),
    });
    await refreshCase(ctx, entry.case_number);
    audit();
    return;
  }
  if (['confirm', 'cancel', 'duration'].includes(action) && arg !== i.user.id) {
    await deny('This confirmation belongs to another moderator.');
    return;
  }
  if (['void', 'timeout'].includes(action)) {
    if (
      action === 'timeout' &&
      (!entry.actor.startsWith('automod:') || entry.metadata.timeoutCase)
    ) {
      await deny('This action is no longer available.');
      return;
    }
    // Persist the origin before opening a separate ephemeral confirmation.
    if (!panel.message || panel.message === '@original') {
      panel.message = panel.token ? '@original' : i.message.id;
      panel.channel = i.channelId;
      ctx.store!.setSetting(key(ctx, id), panel);
    }
    await i.deferReply({ ephemeral: true });
    await refreshCase(ctx, entry.case_number);
    await i.editReply({
      content:
        action === 'void'
          ? `Void case #${entry.case_number}?`
          : `Timeout <@${entry.user_id}> · case #${entry.case_number}`,
      ephemeral: true,
      components: [
        row(
          action === 'void'
            ? [
                button(id, 'confirm', 'Confirm', false, i.user.id),
                button(id, 'cancel', 'Cancel', false, i.user.id),
              ]
            : [
                {
                  type: 3,
                  custom_id: idFor(id, 'duration', i.user.id),
                  options: ['10m', '1h', '6h', '24h'].map((label, n) => ({
                    label,
                    value: String(n),
                  })),
                },
              ],
        ),
      ],
      allowedMentions: { parse: [] },
    });
    audit();
    return;
  }
  await i.deferUpdate();
  if (action === 'confirm') {
    ctx.store!.voidCase(ctx.guild.id, entry.case_number, i.user.id);
  } else if (action === 'duration') {
    if (!entry.actor.startsWith('automod:') || entry.metadata.timeoutCase) {
      await i.editReply({
        content: 'This timeout was already handled.',
        components: [],
      });
      return;
    }
    const ms = [600000, 3600000, 21600000, 86400000][Number(i.values?.[0])];
    if (!ms) throw new Error('Invalid duration.');
    const subject = await ctx.guild.members.fetch({
      user: entry.user_id,
      force: true,
    });
    await checkHierarchy(ctx, i, subject, 'timeout');
    await subject.timeout(ms, `Follow-up to case #${entry.case_number}`);
    const timeout = recordCase(ctx, {
      user_id: entry.user_id,
      actor: i.user.id,
      action: 'timeout',
      reason: `Follow-up to case #${entry.case_number}`,
      expires_at: new Date(Date.now() + ms).toISOString(),
      metadata: { sourceCase: String(entry.case_number) },
    });
    ctx.store!.caseMetadata(ctx.guild.id, entry.case_number, {
      timeoutCase: `#${timeout.case_number} · <@${i.user.id}>`,
    });
    await notify(ctx, timeout, subject.user, config);
  } else if (action !== 'cancel') throw new Error('Invalid panel action.');
  audit();
  await refreshCase(ctx, entry.case_number);
  await i.editReply({
    content:
      action === 'cancel'
        ? 'Cancelled.'
        : action === 'confirm'
          ? `Case #${entry.case_number} voided.`
          : `Timeout applied from case #${entry.case_number}.`,
    components: [],
  });
}
