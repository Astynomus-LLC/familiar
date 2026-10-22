import {
  serversView,
  serverView,
  gatewayForm,
  featureConfig,
  refreshMultiPicker,
} from './features.js';
import { clientSetup, checkConnection } from './client-setup.js';
import {
  escape,
  avatar,
  auditTable,
  setup,
  botForm,
  botCard,
  keyForm,
  keyResult,
} from './components.js';
import { pageContent } from './pages.js';

const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
let state;
let page = location.hash.slice(1) || 'dashboard';
let generatedKey;
let installClient = 'codex';
let noticeTimer;
let serverGuilds = [];

async function api(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function notice(message) {
  document.querySelector('#notice').textContent = message;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    document.querySelector('#notice').textContent = '';
  }, 8000);
}

let renderVersion = 0;
async function render() {
  const version = ++renderVersion;
  const route = page;
  if (route.startsWith('servers/')) {
    location.hash = `bots/${route.slice(8)}/servers`;
    return;
  }
  main.setAttribute('aria-busy', 'true');
  try {
    const view = await buildView(route);
    if (version !== renderVersion || route !== page) return;
    state = view.state;
    serverGuilds = view.serverGuilds;
    const account = document.querySelector('#account');
    if (account.innerHTML !== view.account) account.innerHTML = view.account;
    if (nav.innerHTML !== view.nav) nav.innerHTML = view.nav;
    main.innerHTML = view.main;
  } catch (error) {
    if (version === renderVersion && route === page) throw error;
  } finally {
    if (version === renderVersion) main.removeAttribute('aria-busy');
  }
}

// Build the next view off-screen, then commit it once. Slow requests from a
// previous route cannot replace a newer page or collapse the navigation shell.
async function buildView(page) {
  const main = { innerHTML: '' };
  const nav = { innerHTML: '' };
  const account = { innerHTML: '' };
  let session;
  let state;
  let serverGuilds = [];
  async function prepare() {
    session = await api('/api/session');
    account.innerHTML = session.user
      ? `<div class="row">${avatar(session.user)}<small>${escape(session.user.name)} · ${escape(session.user.role)}</small><button class="secondary" data-action="logout">Sign out</button></div>`
      : '';
    nav.innerHTML = '';
    if (session.setupRequired) {
      main.innerHTML = setup(session);
      return;
    }
    if (!session.user) {
      main.innerHTML =
        '<section class="welcome"><p class="eyebrow">Welcome back</p><h1>Your bots. Your Familiar.</h1><p class="muted">Sign in to manage this instance.</p><a class="button" href="/auth/login">Sign in with Discord</a></section>';
      return;
    }
    if (!['owner', 'member'].includes(session.user.role)) {
      main.innerHTML = `<section class="welcome"><h1>${session.user.role === 'denied' ? 'Access not approved' : 'Request access'}</h1><p>${session.user.role === 'denied' ? 'Contact the owner of this instance.' : 'Your Discord profile is in the owner’s approval queue. You can check back here once they approve it.'}</p><button data-action="refresh">Check access</button></section>`;
      return;
    }
    state = await api('/api/admin/state');
    const pages = [
      'dashboard',
      'bots',
      'keys',
      ...(session.user.role === 'owner' ? ['access'] : []),
      'settings',
      'audit log',
    ];
    nav.innerHTML = pages
      .map(
        (name) =>
          `<a href="#${name.replaceAll(' ', '-')}" ${page === name.replaceAll(' ', '-') ? 'aria-current="page"' : ''}>${name[0].toUpperCase() + name.slice(1)}</a>`,
      )
      .join('');
    if (!state.bots.length) {
      main.innerHTML = `<p class="eyebrow">Step 2 of 4 · Add a bot</p><h1>Meet your first bot.</h1><p class="muted">Ownership is claimed. Add your bot, then choose what it can do.</p>${botForm()}`;
      return;
    }
    if (!state.keys.length && page === 'dashboard') {
      main.innerHTML = `<p class="eyebrow">Step 3 of 4 · Choose categories</p><h1>A useful starting point.</h1>${botCard(state, state.bots[0])}<p class="eyebrow">Step 4 of 4 · Connect your agent</p>${keyForm(state)}`;
      return;
    }
    if (generatedKey) {
      main.innerHTML = keyResult(generatedKey, installClient);
      return;
    }
    if (page.startsWith('bots/')) {
      const [, slug, tab = 'tools', guildId, moduleId] = page.split('/');
      const bot = state.bots.find((b) => b.slug === slug);
      if (!bot) throw new Error('Bot not found.');
      if (tab === 'servers') {
        serverGuilds = await api(`/api/admin/bots/${bot.slug}/servers`);
        if (guildId) {
          const guild = serverGuilds.find((g) => g.id === guildId);
          if (!guild) throw new Error('Server not found.');
          const resources = { channels: [], roles: [] };
          if (moduleId) {
            const results = await Promise.allSettled(
              ['channels', 'roles'].map((kind) =>
                api(`/api/admin/bots/${slug}/servers/${guildId}/${kind}`),
              ),
            );
            results.forEach((result, index) => {
              if (result.status === 'fulfilled')
                resources[index ? 'roles' : 'channels'] = result.value;
              else resources.error = result.reason.message;
            });
          }
          main.innerHTML = serverView(
            bot,
            serverGuilds,
            guild,
            moduleId,
            resources,
          );
          return;
        }
      }
      const tabs = [
        ['tools', 'MCP Tools'],
        ['intents', 'Intents'],
        ['keys', 'API Keys'],
        ['servers', 'Servers'],
        ['audit', 'Audit Log'],
      ];
      const header = `<p><a href="#bots">← Bots</a></p><header class="row between panel"><div class="row">${avatar(bot)}<h1>${escape(bot.name)}</h1><span class="badge">${escape(bot.state)}</span></div><button class="secondary" data-action="reconnect" data-slug="${escape(bot.slug)}">Reconnect</button></header><nav class="bot-tabs" aria-label="Bot sections">${tabs.map(([id, label]) => `<a href="#bots/${escape(bot.slug)}/${id}" ${id === tab ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
      const content =
        tab === 'tools'
          ? botCard(state, bot)
          : tab === 'intents'
            ? gatewayForm(state, bot)
            : tab === 'servers'
              ? serversView(bot, serverGuilds)
              : tab === 'keys'
                ? pageContent(
                    'keys',
                    {
                      ...state,
                      bots: [bot],
                      keys: state.keys.filter(
                        (key) => key.bots === null || key.bots.includes(slug),
                      ),
                    },
                    session,
                  )
                : tab === 'audit'
                  ? `<h2>Audit log</h2>${auditTable(await api(`/api/admin/audit?bot=${encodeURIComponent(slug)}`))}`
                  : '<p>Section not found.</p>';
      main.innerHTML = header + content;
      return;
    }
    const entries = page === 'audit-log' ? await api('/api/admin/audit') : [];
    const people =
      page === 'access' && session.user.role === 'owner'
        ? await api('/api/admin/access')
        : [];
    main.innerHTML = pageContent(page, state, session, entries, people);
  }
  await prepare();
  return {
    main: main.innerHTML,
    nav: nav.innerHTML,
    account: account.innerHTML,
    session,
    state,
    serverGuilds,
  };
}

async function submit(form) {
  const data = new FormData(form);
  const values = Object.fromEntries(data);
  const kind = form.dataset.form;
  if (kind === 'setup-code') await api('/api/setup/verify', 'POST', values);
  if (kind === 'setup-oauth') {
    await api('/api/setup/oauth', 'POST', values);
    location.href = '/auth/login';
    return;
  }
  if (kind === 'bot' || kind === 'token') {
    const bot = state.bots.find((bot) => bot.slug === form.dataset.slug);
    await api('/api/admin/bots', 'POST', {
      slug: bot?.slug ?? values.slug,
      token: values.token,
      categories: bot?.categories ?? ['messages'],
    });
    notice('Token validated. Bot saved.');
  }
  if (kind === 'categories') {
    await api(`/api/admin/bots/${form.dataset.slug}`, 'PATCH', {
      categories: data.getAll('categories'),
    });
    state.bots.find((bot) => bot.slug === form.dataset.slug).categories =
      data.getAll('categories');
    notice('Categories saved. Connected agents have been notified.');
    return;
  }
  if (kind === 'gateway') {
    await api(`/api/admin/bots/${form.dataset.slug}/gateway`, 'PATCH', {
      intents: data.getAll('intents'),
      messageCacheSize: Number(values.messageCacheSize),
    });
    notice('Gateway settings saved. Bot reconnected.');
  }
  if (kind === 'feature' || kind === 'module') {
    const guild = serverGuilds.find((g) => g.id === form.dataset.guild);
    const isModule = kind === 'module';
    const item = isModule
      ? guild.modules.find((m) => m.id === form.dataset.id)
      : guild.features.find((f) => f.featureId === form.dataset.id);
    await api(
      `/api/admin/bots/${form.dataset.slug}/${isModule ? 'modules' : 'features'}`,
      'PATCH',
      {
        guild: guild.id,
        [isModule ? 'moduleId' : 'featureId']: form.dataset.id,
        config: featureConfig(form, item.fields),
      },
    );
    notice('Settings saved.');
  }
  if (kind === 'key') {
    const bots = values.scope === 'all' ? null : data.getAll('bots');
    if (bots?.length === 0) throw new Error('Select at least one bot.');
    generatedKey = await api('/api/admin/keys', 'POST', {
      label: values.label,
      bots,
      readOnly: Boolean(values.readOnly),
      categories: values.ceiling ? data.getAll('categories') : null,
    });
    page = 'keys';
  }
  if (kind === 'settings') {
    await api('/api/admin/settings', 'PATCH', {
      defaultBot: values.defaultBot,
      readOnly: Boolean(values.readOnly),
    });
    state.defaultBot = values.defaultBot;
    state.readOnly = Boolean(values.readOnly);
    notice('Settings saved.');
    return;
  }
  if (kind === 'oauth') {
    await api('/api/admin/oauth', 'POST', values);
    form.reset();
    notice('OAuth credentials saved.');
    return;
  }
  if (kind === 'manual-access')
    await api('/api/admin/access', 'POST', { id: values.id, role: 'member' });
  if (
    kind === 'ownership' &&
    confirm(
      'Transfer ownership to this member? You will lose access management.',
    )
  )
    await api('/api/admin/ownership', 'POST', {
      id: values.id,
      confirm: 'transfer ownership',
    });
  await render();
}

async function action(button) {
  const { action, slug, id, role, before } = button.dataset;
  if (action === 'toggle-module' || action === 'toggle-feature') {
    const isModule = action === 'toggle-module';
    const enabled = button.dataset.enabled === 'true';
    const guild = serverGuilds.find((g) => g.id === button.dataset.guild);
    const item = isModule
      ? guild.modules.find((m) => m.id === id)
      : guild.features.find((f) => f.featureId === id);
    const form = button.closest('.feature-card')?.querySelector('form');
    await api(
      `/api/admin/bots/${slug}/${isModule ? 'modules' : 'features'}`,
      'PATCH',
      {
        guild: guild.id,
        [isModule ? 'moduleId' : 'featureId']: id,
        enabled,
        ...(!isModule && enabled && !item.config && form
          ? { config: featureConfig(form, item.fields) }
          : {}),
      },
    );
  }
  if (action === 'reconnect') {
    const bot = state.bots.find((b) => b.slug === slug);
    await api(`/api/admin/bots/${slug}/gateway`, 'PATCH', {
      intents: bot.intents,
      messageCacheSize: bot.messageCacheSize,
    });
    notice('Bot reconnected.');
  }
  if (action === 'logout') {
    await api('/api/logout', 'POST', {});
    generatedKey = undefined;
  }
  if (action === 'delete-bot') {
    const affected = await api(`/api/admin/bots/${slug}/affected-keys`);
    const warning =
      affected
        .map(
          (key) =>
            `${key.label}${key.becomesInert ? ' (will become inert)' : ''}`,
        )
        .join(', ') || 'None';
    if (!confirm(`Remove ${slug}? Affected scoped keys: ${warning}.`)) return;
    await api(`/api/admin/bots/${slug}`, 'DELETE', { confirm: slug });
  }
  if (action === 'revoke-key') {
    if (!confirm('Revoke this key and disconnect its live sessions?')) return;
    await api(`/api/admin/keys/${id}`, 'DELETE', {});
  }
  if (action === 'access') await api('/api/admin/access', 'POST', { id, role });
  if (['copy-key', 'copy-config', 'copy-command'].includes(action)) {
    await navigator.clipboard.writeText(
      action === 'copy-key'
        ? generatedKey.secret
        : clientSetup(generatedKey, installClient)[
            action === 'copy-command' ? 'command' : 'config'
          ],
    );
    notice('Copied.');
    return;
  }
  if (action === 'check-connection') {
    const result = document.querySelector('#connection-result');
    result.textContent = 'Checking authentication and tools…';
    try {
      const count = await checkConnection(generatedKey);
      result.textContent = count
        ? `Connected from this browser. Authentication passed; ${count} tools available. Now restart your agent and ask it to call list_bots.`
        : 'Authentication passed, but no tools are available. Check this key’s bot scope and the bot’s categories.';
    } catch (error) {
      result.textContent = `Connection check failed: ${error.message}`;
    }
    return;
  }
  if (action === 'dismiss-key') generatedKey = undefined;
  if (action === 'older-audit') {
    const entries = await api(`/api/admin/audit?before=${before}`);
    document.querySelector('#audit-entries').innerHTML = auditTable(entries);
    if (entries.length === 100) button.dataset.before = entries.at(-1).id;
    else button.remove();
    return;
  }
  await render();
}

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-multi-add]')) {
    const select = event.target;
    const picker = select.closest('.multi-picker');
    if (select.value) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = picker.dataset.name;
      input.value = select.value;
      picker.querySelector('.multi-values').append(input);
      refreshMultiPicker(picker);
    }
    return;
  }
  if (['server-switcher', 'module-picker'].includes(event.target.id))
    location.hash = event.target.value;
  if (event.target.id !== 'install-client' || !generatedKey) return;
  installClient = event.target.value;
  main.innerHTML = keyResult(generatedKey, installClient);
  document.querySelector('#install-client').focus();
});

document.addEventListener('submit', async (event) => {
  if (!event.target.matches('form[data-form]')) return;
  event.preventDefault();
  const button = event.target.querySelector('button:not([type="button"])');
  button.disabled = true;
  try {
    await submit(event.target);
  } catch (error) {
    notice(error.message);
  } finally {
    button.disabled = false;
  }
});
document.addEventListener('click', async (event) => {
  const remove = event.target.closest('[data-remove-selection]');
  if (remove) {
    const picker = remove.closest('.multi-picker');
    for (const input of picker.querySelectorAll('input[type="hidden"]'))
      if (input.value === remove.dataset.removeSelection) input.remove();
    refreshMultiPicker(picker);
    picker.querySelector('select').focus();
    return;
  }
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  button.disabled = true;
  try {
    await action(button);
  } catch (error) {
    notice(error.message);
  } finally {
    button.disabled = false;
  }
});
window.addEventListener('hashchange', () => {
  page = location.hash.slice(1) || 'dashboard';
  render().catch((error) => notice(error.message));
});
render().catch((error) => notice(error.message));

// Refresh the overview when another owner or an MCP agent changes stored state.
// Configuration forms are left intact while the owner is editing them.
let refreshingOverview = false;
window.setInterval(async () => {
  const parts = page.split('/');
  if (
    refreshingOverview ||
    document.hidden ||
    parts[0] !== 'bots' ||
    parts[2] !== 'servers' ||
    parts.length !== 4 ||
    document.activeElement?.closest('button, select')
  )
    return;
  refreshingOverview = true;
  const route = page;
  const version = renderVersion;
  if (main.hasAttribute('aria-busy')) {
    refreshingOverview = false;
    return;
  }
  try {
    const guilds = await api(`/api/admin/bots/${parts[1]}/servers`);
    if (
      page !== route ||
      version !== renderVersion ||
      main.hasAttribute('aria-busy')
    )
      return;
    const guild = guilds.find((g) => g.id === parts[3]);
    const previous = serverGuilds.find((g) => g.id === parts[3]);
    if (guild && JSON.stringify(guild) !== JSON.stringify(previous)) {
      serverGuilds = guilds;
      main.innerHTML = serverView(
        state.bots.find((b) => b.slug === parts[1]),
        guilds,
        guild,
        undefined,
        {},
      );
    }
  } catch {
    /* A transient offline bot should not replace the current view. */
  } finally {
    refreshingOverview = false;
  }
}, 5000);
