import type { APIEmbed } from 'discord.js';
import type { ModCase } from '../storage/cases.js';
import type { FeatureContext } from './types.js';
export const palette = {
  ban: 0xed4245,
  kick: 0xe67e22,
  warn: 0xfee75c,
  timeout: 0x9b59b6,
  unban: 0x57f287,
  untimeout: 0x57f287,
  void: 0x57f287,
  automod: 0x7289da,
  purge: 0x95a5a6,
  lock: 0x95a5a6,
  slowmode: 0x95a5a6,
  info: 0x32634c,
};
export function embed(
  title: string,
  fields: NonNullable<APIEmbed['fields']> = [],
  action = 'info',
): APIEmbed {
  return {
    title,
    fields,
    color: palette[action as keyof typeof palette] ?? palette.info,
    footer: { text: 'Familiar' },
    timestamp: new Date().toISOString(),
  };
}
export function actorLabel(actor: string) {
  return /^\d+$/.test(actor)
    ? `<@${actor}>`
    : actor.startsWith('automod:')
      ? 'Auto Moderation'
      : actor.startsWith('agent:')
        ? `Agent: ${actor.slice(6)}`
        : actor.replace(/^system:/, '').replaceAll('-', ' ');
}
export function caseEmbed(
  entry: ModCase,
  ctx?: FeatureContext,
  dm = false,
  compact = false,
): APIEmbed {
  const user = ctx?.client.users?.cache?.get(entry.user_id);
  const auto = entry.actor.startsWith('automod:');
  const milliseconds = entry.expires_at
    ? Date.parse(entry.expires_at) - Date.parse(entry.created_at)
    : 0;
  const durationText = formatDuration(milliseconds);
  const result = embed(
    dm
      ? `${ctx?.guild.name} · ${entry.action}`
      : `Case #${entry.case_number} · ${entry.action}`,
    [],
    !entry.active ? 'void' : auto ? 'automod' : entry.action,
  );
  result.author = {
    name: user?.tag ?? entry.user_id,
    icon_url: user?.displayAvatarURL(),
  };
  const icon = ctx?.guild.iconURL?.();
  if (icon) result.thumbnail = { url: icon };
  result.fields = [
    { name: 'Member', value: `<@${entry.user_id}> · ${entry.user_id}` },
    ...(!dm ? [{ name: 'Moderator', value: actorLabel(entry.actor) }] : []),
    {
      name: 'Reason',
      value: entry.reason.slice(0, 1024) || 'No reason provided',
    },
  ];
  if (entry.expires_at)
    result.fields.push({
      name: 'Duration / Expires',
      value: `${durationText} · <t:${Math.floor(Date.parse(entry.expires_at) / 1000)}:F>`,
    });
  if (!dm)
    result.fields.push({
      name: 'Status',
      value: !entry.active
        ? `Voided${entry.metadata.voidedBy ? ` by ${actorLabel(entry.metadata.voidedBy)}` : ''}`
        : entry.expires_at && Date.parse(entry.expires_at) <= Date.now()
          ? 'Expired'
          : 'Active',
    });
  if (auto && !dm)
    for (const [key, name] of Object.entries({
      channel: 'Channel',
      feature: 'Rule / feature',
      matched: 'Matched term',
      outcome: 'Action taken',
      jump: 'Message',
      timeoutCase: 'Moderator timeout case',
    })) {
      if (entry.metadata[key])
        result.fields.push({ name, value: entry.metadata[key].slice(0, 1024) });
    }
  if (dm) {
    const outcomes: Record<string, string> = {
      warn: 'warned',
      ban: 'banned',
      kick: 'kicked',
      timeout: 'timed out',
      unban: 'unbanned',
      untimeout: 'released from timeout',
    };
    result.description = `You were ${outcomes[entry.action] ?? entry.action} in **${ctx?.guild.name}**${entry.expires_at ? ` for ${durationText}` : ''}.`;
  }
  result.footer = { text: `Case #${entry.case_number} • Familiar` };
  if (compact)
    result.fields = result.fields.map((field) => ({
      ...field,
      value: field.value.slice(0, field.name === 'Reason' ? 300 : 150),
    }));
  result.timestamp = entry.created_at;
  return result;
}
function formatDuration(ms: number) {
  for (const [unit, size] of [
    ['d', 86400000],
    ['h', 3600000],
    ['m', 60000],
  ] as const) {
    if (ms >= size && Math.abs(ms / size - Math.round(ms / size)) < 0.001)
      return `${Math.round(ms / size)}${unit}`;
  }
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}
export function noticeEmbed(rule: string, action: string) {
  const reasons: Record<string, string> = {
    'link-filter': 'this link is not allowed here',
    'word-filter': 'a blocked word or phrase was detected',
    'attachment-filter': 'this attachment is not allowed here',
    'mention-limit': 'too many mentions',
    'caps-filter': 'too many capital letters',
    'repeat-filter': 'repeated messages are not allowed here',
  };
  return {
    ...embed('Auto Moderation', [], 'automod'),
    description: `${action.includes('delete') ? (rule === 'link-filter' ? 'Link removed' : 'Message removed') : action === 'timeout' ? 'Member timed out' : action === 'kick' ? 'Member kicked' : 'Warning issued'} — ${reasons[rule] ?? rule}.`,
  };
}
