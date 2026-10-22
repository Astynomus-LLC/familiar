import {
  escape,
  date,
  avatar,
  check,
  auditTable,
  botForm,
  botTile,
  keyForm,
} from './components.js';

export function pageContent(page, state, session, entries = [], people = []) {
  if (page === 'dashboard')
    return `<p class="eyebrow">Your instance</p>
<h1>Everything, at a glance.</h1>
<p class="muted">Your Discord bots and the work they’re doing.</p>
<div class="grid">
<div class="panel">
<p class="muted">Bots online</p>
<div class="metric">${state.bots.filter((bot) => bot.state === 'online').length} <small>/ ${state.bots.length}</small>
</div>
</div>
<div class="panel">
<p class="muted">Connected guilds</p>
<div class="metric">${state.bots.reduce((total, bot) => total + bot.guilds, 0)}</div>
</div>
<div class="panel">
<p class="muted">Active keys</p>
<div class="metric">${state.keys.length}</div>
</div>
</div>
<section class="panel">
<h2>Bots</h2>${state.bots.flatMap((bot) => (bot.degraded ?? []).map((f) => `<p class="badge offline">${escape(bot.name)} · ${escape(f.guildId)} · ${escape(f.name)}: ${escape(f.missingIntents.map((i) => `needs ${i}`).join(', '))}</p>`)).join('')}${state.bots
      .map(
        (
          bot,
        ) => `<p class="row">${avatar(bot)}<strong>${escape(bot.name)}</strong>
<small>${escape(bot.slug)}</small>
<span class="badge ${bot.state === 'online' ? '' : 'offline'}">${escape(bot.state)}</span>
</p>`,
      )
      .join('')}</section>
<section class="panel">
<h2>Recent activity</h2>${auditTable(state.audit)}</section>`;
  else if (page === 'bots')
    return `<h1>Bots</h1>
<p class="muted">A separate identity and set of capabilities for each bot.</p><div class="grid">${state.bots.map(botTile).join('')}</div>${botForm()}`;
  else if (page === 'keys')
    return `<h1>API keys</h1>
<p class="muted">Give each agent only the bots and capabilities it needs.</p>
<section class="panel">
<div class="table-wrap">
<table>
<thead>
<tr>
<th>Label</th>
<th>Scope</th>
<th>Restrictions</th>
<th>Created / last used</th>
<th>
</th>
</tr>
</thead>
<tbody>${state.keys
      .map(
        (key) => `<tr>
<td>${escape(key.label)}</td>
<td>${escape(key.bots === null ? 'All bots' : key.bots.join(', ') || 'Inert — no bots')}</td>
<td>${key.readOnly ? 'Read-only' : 'Read/write'}<br>
<small>${escape(key.categories === null ? 'No category ceiling' : key.categories.join(', ') || 'Orientation only')}</small>
</td>
<td>${escape(date(key.created))}<br>
<small>${escape(date(key.lastUsed))}</small>
</td>
<td>
<button class="danger" data-action="revoke-key" data-id="${escape(key.id)}">Revoke</button>
</td>
</tr>`,
      )
      .join('')}</tbody>
</table>
</div>
</section>${keyForm(state)}`;
  else if (page === 'settings')
    return `<h1>Settings</h1>
<form data-form="settings" class="panel">
<h2>Instance</h2>
<label>Public URL<input value="${escape(session.publicUrl)}" readonly>
</label>
<label>Default bot<select name="defaultBot">${state.bots.map((bot) => `<option value="${escape(bot.slug)}" ${state.defaultBot === bot.slug ? 'selected' : ''}>${escape(bot.name)} (${escape(bot.slug)})</option>`).join('')}</select>
</label>${check('readOnly', 'yes', state.readOnly, 'Server-wide read-only mode')}<p class="muted">Read-only mode disables all Discord mutations, including raw API writes.</p>
<button>Save settings</button>
</form>
<form data-form="oauth" class="panel">
<h2>Discord sign-in application</h2>
<p class="muted">Replace the OAuth credentials if you rotate the secret. Keep this redirect URL registered in the application:</p>
<pre>${escape(session.redirectUri)}</pre>
<label>Application ID<input name="clientId" required pattern="[0-9]+"></label>
<label>OAuth client secret<input name="clientSecret" type="password" required autocomplete="new-password"></label>
<button class="secondary">Replace OAuth credentials</button>
</form>`;
  else if (page === 'audit-log') {
    return `<h1>Audit log</h1>
<p class="muted">Local records of mutating tool calls. Message bodies and tokens are not recorded.</p>
<section class="panel" id="audit-entries">${auditTable(entries)}</section>${entries.length === 100 ? `<button data-action="older-audit" data-before="${entries.at(-1).id}">Older entries</button>` : ''}`;
  } else if (page === 'access' && session.user.role === 'owner') {
    return `<h1>Access</h1>
<p class="muted">Owners manage access and ownership. Members can manage all other configuration.</p>
<section class="panel">
<h2>People and requests</h2>${people
      .map(
        (person) => `<div class="row between panel">
<div class="row">${avatar(person)}<div>
<strong>${escape(person.name)}</strong>
<br>
<small>${escape(person.id)} · ${escape(person.role)}</small>
</div>
</div>${
          person.role !== 'owner'
            ? `<div class="row">${person.role !== 'member' ? `<button data-action="access" data-id="${escape(person.id)}" data-role="member">Approve</button>` : ''}<button class="secondary" data-action="access" data-id="${escape(person.id)}" data-role="denied">${person.role === 'member' ? 'Remove access' : 'Deny'}</button>
</div>`
            : ''
        }</div>`,
      )
      .join('')}</section>
<form data-form="manual-access" class="panel">
<h2>Add a member</h2>
<label>Discord user ID<input name="id" required pattern="[0-9]+">
</label>
<button>Add to allowlist</button>
</form>
<form data-form="ownership" class="panel">
<h2>Transfer ownership</h2>
<p class="muted">You will become a member. The new owner will control access.</p>
<label>New owner<select name="id">${people
      .filter((person) => person.role === 'member')
      .map(
        (person) =>
          `<option value="${escape(person.id)}">${escape(person.name)}</option>`,
      )
      .join('')}</select>
</label>
<button class="secondary">Transfer ownership</button>
</form>`;
  }
  return '';
}
