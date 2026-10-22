import { serversView, featureConfig } from './features.js';
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
let session;
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

async function render() {
  session = await api('/api/session');
  document.querySelector('#account').innerHTML = session.user
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
  if (page.startsWith('servers/')) {
    const bot = state.bots.find((bot) => bot.slug === page.slice(8));
    if (!bot) throw new Error('Bot not found.');
    serverGuilds = await api(`/api/admin/bots/${bot.slug}/servers`);
    main.innerHTML = serversView(bot, serverGuilds);
    return;
  }
  const entries = page === 'audit-log' ? await api('/api/admin/audit') : [];
  const people =
    page === 'access' && session.user.role === 'owner'
      ? await api('/api/admin/access')
      : [];
  main.innerHTML = pageContent(page, state, session, entries, people);
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
  if (kind === 'feature') {
    const feature = serverGuilds
      .find((g) => g.id === form.dataset.guild)
      .features.find((f) => f.featureId === form.dataset.feature);
    await api(`/api/admin/bots/${form.dataset.slug}/features`, 'PATCH', {
      guild: values.scope === 'all' ? 'all' : form.dataset.guild,
      featureId: feature.featureId,
      enabled: data.has('enabled'),
      ...(data.has('enabled') || feature.config
        ? { config: featureConfig(form, feature.configSchema) }
        : {}),
    });
    notice('Feature saved.');
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
  if (event.target.id !== 'install-client' || !generatedKey) return;
  installClient = event.target.value;
  main.innerHTML = keyResult(generatedKey, installClient);
  document.querySelector('#install-client').focus();
});

document.addEventListener('submit', async (event) => {
  if (!event.target.matches('form[data-form]')) return;
  event.preventDefault();
  const button = event.target.querySelector('button');
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
