import { clientSetup } from './client-setup.js';
export const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ],
  );
export const date = (value) =>
  value ? new Date(value).toLocaleString() : 'Never';
export const avatar = (user) =>
  user.avatar
    ? `<img class="avatar" alt="" src="https://cdn.discordapp.com/avatars/${escape(user.id)}/${escape(user.avatar)}.png?size=64">`
    : '';
export const check = (name, value, checked, label) =>
  `<label>
<input type="checkbox" name="${name}" value="${escape(value)}" ${checked ? 'checked' : ''}>${escape(label)}</label>`;

export function categoryPicker(
  categories,
  selected = ['messages'],
  includeRaw = false,
) {
  const items = categories.filter(
    (category) =>
      category.name !== 'core' && (includeRaw || category.name !== 'raw_api'),
  );
  return `<div class="checks">${items.map((category) => check('categories', category.name, selected.includes(category.name), category.name.replaceAll('_', ' '))).join('')}</div>`;
}

export function auditTable(entries) {
  if (!entries.length) return '<p class="muted">No mutating calls yet.</p>';
  return `<div class="table-wrap">
<table>
<thead>
<tr>
<th>Time</th>
<th>Bot / key</th>
<th>Action</th>
<th>Target</th>
<th>Result</th>
</tr>
</thead>
<tbody>${entries
    .map(
      (entry) => `<tr>
<td>${escape(date(entry.timestamp))}</td>
<td>${escape(entry.bot.name)}<br>
<small>${escape(entry.bot.slug)} · ${escape(entry.key)}</small>
</td>
<td>${escape(entry.tool)}</td>
<td>${escape(entry.target)}</td>
<td>${escape(entry.result)}</td>
</tr>`,
    )
    .join('')}</tbody>
</table>
</div>`;
}

export function setup(session) {
  if (!session.setupVerified)
    return `<section class="welcome">
<p class="eyebrow">Welcome to Familiar</p>
<h1>A little setup.<br>A capable companion.</h1>
<p class="muted">Connect your Discord bots to your agent, on a server you control.</p>
<form data-form="setup-code" class="panel">
<h2>Claim this instance</h2>
<p>Enter the one-time setup code from your Familiar process logs.</p>
<label>Setup code<input name="code" type="password" required autocomplete="off">
</label>
<button>Continue</button>
</form>
</section>`;
  return `<section class="welcome">
<p class="eyebrow">Step 1 of 4 · Ownership</p>
<h1>Your Discord application</h1>
<p class="muted">Use your bot’s own application to sign in. In the Discord developer portal, add this OAuth redirect URL:</p>
<pre>${escape(session.redirectUri)}</pre>
<form data-form="setup-oauth" class="panel">
<label>Application ID<input name="clientId" required inputmode="numeric">
</label>
<label>OAuth client secret<input name="clientSecret" type="password" required autocomplete="new-password">
</label>
<button>Save and sign in with Discord</button>
</form>${session.oauthConfigured ? '<a href="/auth/login">Continue with the saved application</a>' : ''}</section>`;
}

export function botForm() {
  return `<form data-form="bot" class="panel">
<h2>Add a bot</h2>
<div class="grid">
<label>Bot slug<input name="slug" placeholder="hello-bot" pattern="[a-z0-9][a-z0-9-]{0,47}" required>
</label>
<label>Bot token<input name="token" type="password" required autocomplete="new-password">
</label>
</div>
<p class="muted">Familiar validates the token with Discord and shows its real name. The token is encrypted before storage.</p>
<button>Validate and add bot</button>
</form>`;
}

export function botCard(state, bot) {
  return `<section class="panel">
<div class="row between">
<div class="row">${avatar(bot)}<div>
<h2>${escape(bot.name)}</h2>
<small>${escape(bot.slug)} · ${bot.guilds} guilds${state.defaultBot === bot.slug ? ' · Default bot' : ''}</small>
</div>
</div>
<span class="badge ${bot.state === 'online' ? '' : 'offline'}">${escape(bot.state)}</span>
</div>${bot.error ? `<p>${escape(bot.error)}</p>` : ''}<form data-form="categories" data-slug="${escape(bot.slug)}">
<fieldset>
<legend>Enabled categories</legend>
<p class="muted">Core and raw API are always available. Connected agents receive changes immediately.</p>${categoryPicker(state.categories, bot.categories)}</fieldset>
<button>Save categories</button>
</form>
<details>
<summary>Replace token or remove bot</summary>
<form data-form="token" data-slug="${escape(bot.slug)}">
<label>New bot token<input name="token" type="password" autocomplete="new-password" required>
</label>
<button class="secondary">Validate and replace token</button>
</form>
<p>
</p>
<button class="danger" data-action="delete-bot" data-slug="${escape(bot.slug)}">Remove bot</button>
</details>
</section>`;
}

export function keyForm(state) {
  return `<form data-form="key" class="panel">
<h2>Generate a key</h2>
<label>Label<input name="label" placeholder="My desktop agent" required maxlength="100">
</label>
<label>Bot scope<select name="scope">
<option value="selected">Selected bots</option>
<option value="all">All current and future bots</option>
</select>
</label>
<div class="checks">${state.bots.map((bot) => check('bots', bot.slug, state.bots.length === 1, `${bot.name} (${bot.slug})`)).join('')}</div>
<fieldset>
<legend>Restrictions</legend>${check('readOnly', 'yes', false, 'Read-only')}${check('ceiling', 'yes', false, 'Limit categories to the selection below')}<p class="muted">A category ceiling intersects with each bot’s enabled categories. Grant raw API only when the key should reach endpoints outside typed categories.</p>${categoryPicker(state.categories, ['messages'], true)}</fieldset>
<button>Generate key</button>
</form>`;
}

export function keyResult(generatedKey, client = 'codex') {
  const install = clientSetup(generatedKey, client);
  return `<section class="panel">
<p class="eyebrow">Shown once</p>
<h2>Your agent’s key is ready</h2>
<p>Save the key now. Familiar stores only its hash.</p>
<pre>${escape(generatedKey.secret)}</pre>
<button class="secondary" data-action="copy-key">Copy key</button>
<h3>Connect your agent</h3>
<label for="install-client">Client</label><select id="install-client">
${[
  ['codex', 'Codex'],
  ['claude', 'Claude Code'],
  ['opencode', 'OpenCode'],
  ['other', 'Other HTTP client'],
]
  .map(
    ([value, name]) =>
      `<option value="${value}" ${client === value ? 'selected' : ''}>${name}</option>`,
  )
  .join('')}
</select>
<p>${escape(install.instructions)}</p>
<p>The API key is already included. No environment variable or separate login is required. These snippets contain your secret; keep them private and out of source control.</p>
<pre id="client-config">${escape(install.config)}</pre>
<div class="row">
<button data-action="copy-config">Copy ${client === 'claude' ? 'install command' : 'config'}</button>
</div>
${install.command ? `<p>${escape(install.commandHelp)}</p><pre>${escape(install.command)}</pre><button class="secondary" data-action="copy-command">Copy launch command</button>` : ''}
<p>${escape(install.verify)}</p>
<p>For localhost URLs, run the client on the same machine as Familiar.</p>
<button class="secondary" data-action="check-connection">Check connection</button>
<p id="connection-result" role="status">Checks this key and tool discovery from your browser. Your agent must still load its configuration.</p>
<details><summary>Connection troubleshooting</summary><p>If authentication fails, replace the entire Familiar entry with this configuration. If tools are missing, restart the client process and check for project settings overriding it. If no tools are available, check the key’s bot scope and enabled categories. A status label alone is not a tool test: ask the agent to call list_bots.</p></details>
<div class="row">
<button class="secondary" data-action="dismiss-key">I’ve saved it</button>
</div>
</section>`;
}
