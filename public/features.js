import { escape } from './components.js';
export function gatewayForm(state, bot) {
  return `<section class="panel"><h2>Intents · ${escape(bot.name)}</h2><form data-form="gateway" data-slug="${escape(bot.slug)}"><div class="category-grid">${state.intentNames.map((name) => `<label><input type="checkbox" name="intents" value="${name}" ${bot.intents.includes(name) ? 'checked' : ''}> ${name}${['GuildMembers', 'MessageContent', 'GuildPresences'].includes(name) ? '*' : ''}</label>`).join('')}</div><p class="muted">* enable in the Discord dev portal → your app → Bot → Privileged Gateway Intents</p><label>Advanced: cached messages per channel<input name="messageCacheSize" type="number" min="0" max="10000" value="${bot.messageCacheSize}"></label><p class="muted">Saving reconnects this bot. Edited and deleted content is only available from cached messages.</p><button>Save intents and reconnect</button></form><p><a href="#servers/${escape(bot.slug)}">Servers and features →</a></p></section>`;
}
function field(name, schema, value) {
  value ??= schema.default;
  const label = escape(name);
  if (schema.type === 'boolean')
    return `<label><input type="checkbox" name="config:${label}" ${value ? 'checked' : ''}> ${label}</label>`;
  if (schema.type === 'array' && schema.items.enum)
    return `<fieldset><legend>${label}</legend>${schema.items.enum.map((v) => `<label><input type="checkbox" name="config:${label}" value="${escape(v)}" ${(value ?? []).includes(v) ? 'checked' : ''}>${escape(v)}</label>`).join('')}</fieldset>`;
  if (schema.type === 'array')
    return `<label>${label} (comma-separated IDs)<input name="config:${label}" value="${escape((value ?? []).join(', '))}"></label>`;
  return `<label>${label}<input name="config:${label}" type="${schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'}" value="${escape(value ?? '')}" ${schema.minimum !== undefined ? `min="${schema.minimum}"` : ''} ${schema.maximum !== undefined ? `max="${schema.maximum}"` : ''}></label>`;
}
export function serversView(bot, guilds) {
  return `<h1>${escape(bot.name)} · Servers</h1><p class="muted">Features are independent in each server. New servers start with everything off.</p>${
    guilds
      .map(
        (guild) =>
          `<details class="panel"><summary>${escape(guild.name)} (${escape(guild.id)})</summary>${guild.features
            .map(
              (f) =>
                `<section><h2>${escape(f.name)} <span class="badge">${f.state === 'degraded' ? escape(f.missingIntents.map((i) => `needs ${i}`).join(', ')) : f.state}</span></h2><p>${escape(f.description)}</p><form data-form="feature" data-slug="${escape(bot.slug)}" data-guild="${escape(guild.id)}" data-feature="${escape(f.featureId)}"><label><input type="checkbox" name="enabled" ${f.enabled ? 'checked' : ''}> Enabled</label>${Object.entries(
                  f.configSchema.properties,
                )
                  .map(([name, schema]) =>
                    field(name, schema, f.config?.[name]),
                  )
                  .join(
                    '',
                  )}<label>Apply scope<select name="scope"><option value="this">This server</option><option value="all">All servers</option></select></label><button>Save feature</button></form></section>`,
            )
            .join('')}</details>`,
      )
      .join('') || '<p>No servers found.</p>'
  }`;
}
export function featureConfig(form, schema) {
  const data = new FormData(form);
  return Object.fromEntries(
    Object.entries(schema.properties).map(([name, field]) => {
      const key = `config:${name}`;
      const value =
        field.type === 'boolean'
          ? data.has(key)
          : field.type === 'array'
            ? field.items.enum
              ? data.getAll(key)
              : String(data.get(key))
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean)
            : ['number', 'integer'].includes(field.type)
              ? Number(data.get(key))
              : data.get(key);
      return [name, value];
    }),
  );
}
