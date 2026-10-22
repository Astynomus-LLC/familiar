import { escape } from './components.js';
export function gatewayForm(state, bot) {
  return `<section class="panel"><h2>Intents · ${escape(bot.name)}</h2><form data-form="gateway" data-slug="${escape(bot.slug)}"><div class="category-grid">${state.intentNames.map((name) => `<label><input type="checkbox" name="intents" value="${name}" ${bot.intents.includes(name) ? 'checked' : ''}> ${name}${['GuildMembers', 'MessageContent', 'GuildPresences'].includes(name) ? '*' : ''}</label>`).join('')}</div><p class="muted">* enable in the Discord dev portal → your app → Bot → Privileged Gateway Intents</p><label>Advanced: cached messages per channel<input name="messageCacheSize" type="number" min="0" max="10000" value="${bot.messageCacheSize}"></label><p class="muted">Saving reconnects this bot. Edited and deleted content is only available from cached messages.</p><button>Save intents and reconnect</button></form></section>`;
}

export function guildIcon(guild) {
  return guild.icon
    ? `<img class="avatar" alt="" src="https://cdn.discordapp.com/icons/${escape(guild.id)}/${escape(guild.icon)}.png?size=64">`
    : `<span class="avatar initials" aria-hidden="true">${escape(guild.name.slice(0, 2).toUpperCase())}</span>`;
}
const base = (bot, guild) =>
  `#bots/${escape(bot.slug)}/servers/${escape(guild.id)}`;
export function serversView(bot, guilds) {
  return `<h2>Servers</h2><div class="grid">${guilds.map((guild) => `<a class="panel card-link" href="${base(bot, guild)}">${guildIcon(guild)}<h3>${escape(guild.name)}</h3><p>${guild.features.filter((f) => f.effectiveEnabled).length} of ${guild.features.length} features on</p></a>`).join('') || '<p>No servers found.</p>'}</div>`;
}
const toggle = (bot, guild, item, module = false) =>
  `<button type="button" role="switch" aria-checked="${item.enabled}" aria-label="${escape(item.label)} enabled" class="switch" data-action="toggle-${module ? 'module' : 'feature'}" data-slug="${escape(bot.slug)}" data-guild="${escape(guild.id)}" data-id="${escape(module ? item.id : item.featureId)}" data-enabled="${!item.enabled}"><span></span></button>`;
const glance = (module) =>
  `<p class="muted">${module.features.filter((f) => f.enabled).length} of ${module.features.length} features on${!module.enabled ? ' · Module is off' : ''}</p>${module.features.some((f) => f.missingIntents.length) ? '<span class="badge offline">Degraded · missing intents</span>' : ''}`;
const colorDot = (color) =>
  color
    ? `<svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${/^#[0-9a-f]{6}$/i.test(color) ? color : '#888888'}"/></svg>`
    : '';
function selectionPill(option) {
  return `<span class="selection-pill">${colorDot(option.color)}<span>${escape(option.label)}</span><button type="button" class="pill-remove" aria-label="Remove ${escape(option.label)}" data-remove-selection="${escape(option.value)}">×</button></span>`;
}
function multiPicker(name, ui, options, selected) {
  const empty =
    ui.type === 'roles'
      ? 'No roles selected. No roles will be assigned.'
      : 'No channels selected. No channels are ignored.';
  return `<fieldset class="multi-picker" data-name="config:${escape(name)}" data-empty="${escape(empty)}"><legend>${escape(ui.label)}</legend><select data-multi-add aria-label="${escape(ui.label)}"><option value="">${ui.type === 'roles' ? 'Add a role…' : 'Add a channel…'}</option>${options.map((o) => `<option value="${escape(o.value)}" data-label="${escape(o.label)}" data-color="${escape(o.color ?? '')}" ${selected.includes(o.value) ? 'disabled' : ''}>${escape(o.label)}</option>`).join('')}</select><div class="multi-values">${selected.map((id) => `<input type="hidden" name="config:${escape(name)}" value="${escape(id)}">`).join('')}</div><div class="selection-pills" aria-live="polite">${selected.length ? selected.map((id) => selectionPill(options.find((o) => o.value === id))).join('') : `<small>${empty}</small>`}</div><small>${escape(ui.help)}</small></fieldset>`;
}
export function refreshMultiPicker(picker) {
  const selected = [...picker.querySelectorAll('input[type="hidden"]')].map(
    (input) => input.value,
  );
  const select = picker.querySelector('select');
  const options = [...select.options].filter((option) => option.value);
  for (const option of options)
    option.disabled = selected.includes(option.value);
  select.value = '';
  picker.querySelector('.selection-pills').innerHTML = selected.length
    ? selected
        .map((id) => {
          const option = options.find((o) => o.value === id);
          return selectionPill({
            value: id,
            label: option.dataset.label,
            color: option.dataset.color,
          });
        })
        .join('')
    : `<small>${escape(picker.dataset.empty)}</small>`;
}

function field(name, ui, schema, value, resources) {
  value ??= schema.default;
  const key = `config:${escape(name)}`;
  const label = escape(ui.label);
  let input;
  if (ui.type === 'toggle')
    input = `<input type="checkbox" role="switch" name="${key}" ${value ? 'checked' : ''}>`;
  else if (
    ['channel', 'channels', 'role', 'roles', 'select'].includes(ui.type)
  ) {
    const multi = ['channels', 'roles'].includes(ui.type);
    const role = ui.type.startsWith('role');
    const choices =
      ui.type === 'select'
        ? ui.options
        : resources[role ? 'roles' : 'channels'];
    const selected = multi ? (value ?? []) : [value];
    const types = {
      0: 'Text',
      2: 'Voice',
      4: 'Category',
      5: 'Announcement',
      13: 'Stage',
      15: 'Forum',
      16: 'Media',
    };
    const options = (choices ?? []).map((choice) => ({
      value: choice.id ?? choice.value,
      label:
        choice.label ??
        `${role ? '' : '# '}${choice.name}${role ? '' : ` · ${types[choice.type] ?? 'Channel'}`}`,
      color: choice.color,
    }));
    for (const id of selected)
      if (id && !options.some((o) => o.value === id))
        options.push({ value: id, label: 'Unavailable saved choice' });
    if (multi) return multiPicker(name, ui, options, selected);
    input = `<select name="${key}"><option value="">Choose…</option>${options.map((o) => `<option value="${escape(o.value)}" ${selected.includes(o.value) ? 'selected' : ''}>${escape(o.label)}</option>`).join('')}</select>`;
  } else if (ui.type === 'textarea')
    input = `<textarea name="${key}" ${schema.maxLength ? `maxlength="${schema.maxLength}"` : ''}>${escape(value ?? '')}</textarea>`;
  else
    input = `<input name="${key}" type="${ui.type === 'number' ? 'number' : 'text'}" value="${escape(value ?? '')}" ${schema.minimum !== undefined ? `min="${schema.minimum}"` : ''} ${schema.maximum !== undefined ? `max="${schema.maximum}"` : ''}>`;
  return `<label>${label}${input}<small>${escape(ui.help)}</small></label>`;
}
function configForm(bot, guild, item, resources, module = false) {
  return `<form data-form="${module ? 'module' : 'feature'}" data-slug="${escape(bot.slug)}" data-guild="${escape(guild.id)}" data-id="${escape(module ? item.id : item.featureId)}">${Object.entries(
    item.fields,
  )
    .map(([name, ui]) =>
      field(
        name,
        ui,
        item.configSchema.properties[name],
        item.config?.[name],
        resources,
      ),
    )
    .join('')}<button>Save settings</button></form>`;
}
export function serverView(bot, guilds, guild, moduleId, resources) {
  const module = guild.modules.find((m) => m.id === moduleId);
  const links = [{ id: '', label: 'Overview' }, ...guild.modules];
  const navigation = links
    .map(
      (m) =>
        `<a href="${base(bot, guild)}${m.id ? `/${escape(m.id)}` : ''}" ${m.id === (moduleId ?? '') ? 'aria-current="page"' : ''}>${escape(m.label)}</a>`,
    )
    .join('');
  const overview = `<h2>Modules</h2><p class="muted">Control your server’s features in one place. Turning a module off preserves its settings.</p><div class="grid">${guild.modules.map((m) => `<section class="panel module-card"><div class="row between"><h3>${escape(m.label)}</h3>${toggle(bot, guild, m, true)}</div><p>${escape(m.description)}</p>${glance(m)}<p><a href="${base(bot, guild)}/${escape(m.id)}">Configure ${escape(m.label)} →</a></p></section>`).join('')}</div>`;
  const content = module
    ? `<div class="row between"><div><h2>${escape(module.label)}</h2><p>${escape(module.description)}</p></div>${toggle(bot, guild, module, true)}</div>${glance(module)}${Object.keys(module.fields).length ? `<section class="panel"><h3>Shared settings</h3>${configForm(bot, guild, module, resources, true)}</section>` : ''}${module.features.map((f) => `<section class="panel feature-card ${!module.enabled ? 'suspended' : ''}"><div class="row between"><h3>${escape(f.label)}</h3>${toggle(bot, guild, f)}</div><p>${escape(f.description)}</p>${!module.enabled ? '<p class="badge">Suspended · module is off</p>' : ''}${f.missingIntents.length ? `<p class="badge offline">Needs ${escape(f.missingIntents.map((i) => i.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', '))}</p>` : ''}${Object.keys(f.fields).length ? `<details ${f.enabled ? 'open' : ''}><summary>Configure ${escape(f.label)}</summary>${configForm(bot, guild, f, resources)}</details>` : ''}</section>`).join('')}`
    : moduleId
      ? '<p>Module not found.</p>'
      : overview;
  return `<p><a href="#bots/${escape(bot.slug)}/servers">← ${escape(bot.name)} / Servers</a></p><header class="server-header panel"><div class="row">${guildIcon(guild)}<h1>${escape(guild.name)}</h1></div><label>Server<select id="server-switcher">${guilds.map((g) => `<option value="#bots/${escape(bot.slug)}/servers/${escape(g.id)}${moduleId ? `/${escape(moduleId)}` : ''}" ${g.id === guild.id ? 'selected' : ''}>${escape(g.name)}</option>`).join('')}</select></label></header><div class="server-layout"><nav class="module-nav" aria-label="Modules">${navigation}</nav><label class="module-picker">Module<select id="module-picker">${links.map((m) => `<option value="${base(bot, guild)}${m.id ? `/${escape(m.id)}` : ''}" ${m.id === (moduleId ?? '') ? 'selected' : ''}>${escape(m.label)}</option>`).join('')}</select></label><div>${resources.error ? `<p role="status">${escape(resources.error)}</p>` : ''}${content}</div></div>`;
}
export function featureConfig(form, fields) {
  const data = new FormData(form);
  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => {
      const key = `config:${name}`;
      return [
        name,
        field.type === 'toggle'
          ? data.has(key)
          : ['channels', 'roles'].includes(field.type)
            ? data.getAll(key)
            : field.type === 'number'
              ? Number(data.get(key))
              : data.get(key),
      ];
    }),
  );
}
