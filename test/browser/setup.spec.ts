import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { test, expect } from '@playwright/test';

test('setup wizard through scoped key and client configuration', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { code } = await (await request.get('/test/setup-code')).json();
  await page.route('**/auth/login', async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const state = new URL(response.headers().location).searchParams.get(
      'state',
    );
    await route.fulfill({
      status: 302,
      headers: {
        location: `http://localhost:3210/auth/callback?code=mock&state=${state}`,
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Setup code').fill(code);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Application ID').fill('123');
  await page.getByLabel('OAuth client secret').fill('mock-secret');
  await page
    .getByRole('button', { name: 'Save and sign in with Discord' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Meet your first bot.' }),
  ).toBeVisible();
  await page.getByLabel('Bot slug').fill('hello-bot');
  await page.getByLabel('Bot token', { exact: true }).fill('hello-token');
  await page.getByRole('button', { name: 'Validate and add bot' }).click();
  await expect(
    page.getByRole('heading', { name: 'A useful starting point.' }),
  ).toBeVisible();
  const categories = page.locator('form[data-form="categories"]');
  await categories.getByLabel('moderation', { exact: true }).check();
  await categories.getByRole('button', { name: 'Save categories' }).click();
  await page.getByLabel('Label', { exact: true }).fill('Desktop agent');
  await page.getByRole('button', { name: 'Generate key' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your agent’s key is ready' }),
  ).toBeVisible();
  await expect(page.locator('pre').last()).toContainText(
    'http://localhost:3210/mcp',
  );
  const secret = (await page.locator('pre').first().textContent())!;
  await expect(page.locator('#client-config')).toContainText(
    '[mcp_servers.familiar]',
  );
  await expect(page.locator('#client-config')).not.toContainText(
    'bearer_token_env_var',
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy config', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    `Authorization = "Bearer ${secret}"`,
  );
  await page
    .getByRole('button', { name: 'Check connection', exact: true })
    .click();
  await expect(page.locator('#connection-result')).toContainText(
    'Authentication passed;',
  );
  await page.getByLabel('Client', { exact: true }).selectOption('claude');
  await expect(page.locator('#client-config')).toContainText(
    'claude mcp add --transport http --scope user',
  );
  await page
    .getByRole('button', { name: 'Copy install command', exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    `Authorization: Bearer ${secret}`,
  );
  await page.getByLabel('Client', { exact: true }).selectOption('opencode');
  const openCode = JSON.parse(
    (await page.locator('#client-config').textContent())!,
  );
  expect(openCode.mcp.familiar).toMatchObject({
    type: 'remote',
    oauth: false,
    headers: { Authorization: `Bearer ${secret}` },
  });
  await page.getByLabel('Client', { exact: true }).selectOption('other');
  expect(
    JSON.parse((await page.locator('#client-config').textContent())!).mcpServers
      .familiar.headers.Authorization,
  ).toBe(`Bearer ${secret}`);
  await page.route('**/mcp', (route) =>
    route.fulfill({ status: 401, body: 'Unauthorized' }),
  );
  await page
    .getByRole('button', { name: 'Check connection', exact: true })
    .click();
  await expect(page.locator('#connection-result')).toContainText(
    'API key rejected',
  );
  await page.unroute('**/mcp');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'I’ve saved it' }).click();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Everything, at a glance.' }),
  ).toBeVisible();
  await page.screenshot({
    path: '/tmp/familiar-dashboard.png',
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Bots', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'hello', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'hello', exact: true }) })
    .click();
  await expect(page.getByLabel('moderation', { exact: true })).toBeChecked();
  // Keep the shell intact while loading, and ignore a slower, abandoned route.
  let releaseServers!: () => void;
  let serversHeld!: () => void;
  let serversFinished!: () => void;
  const holdServers = new Promise<void>((resolve) => {
    releaseServers = resolve;
  });
  const heldServers = new Promise<void>((resolve) => {
    serversHeld = resolve;
  });
  const finishedServers = new Promise<void>((resolve) => {
    serversFinished = resolve;
  });
  await page.route('**/api/admin/bots/hello-bot/servers', async (route) => {
    const response = await route.fetch();
    serversHeld();
    await holdServers;
    await route.fulfill({ response });
    serversFinished();
  });
  await page.getByRole('link', { name: 'Servers', exact: true }).click();
  await heldServers;
  await expect(
    page.locator('#nav').getByRole('link', { name: 'Bots', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('moderation', { exact: true })).toBeChecked();
  await page.getByRole('link', { name: 'Intents', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Intents · hello' }),
  ).toBeVisible();
  releaseServers();
  await finishedServers;
  await page.unroute('**/api/admin/bots/hello-bot/servers');
  await expect(
    page.getByRole('heading', { name: 'Intents · hello' }),
  ).toBeVisible();
  await expect(page.locator('#main')).not.toHaveAttribute('aria-busy');
  await page.getByRole('link', { name: 'MCP Tools', exact: true }).click();
  const messagesCategory = page
    .locator('.tool-category')
    .filter({ has: page.getByLabel('messages', { exact: true }) });
  await expect(
    messagesCategory.getByText('messages_send', { exact: true }),
  ).not.toBeVisible();
  await messagesCategory.locator('summary').click();
  await expect(
    messagesCategory.getByText('messages_send', { exact: true }),
  ).toBeVisible();
  await expect(messagesCategory).toContainText(
    'Send a message. Mentions are disabled by default.',
  );
  await expect(
    messagesCategory.getByLabel('messages', { exact: true }),
  ).toBeChecked();

  const client = new Client({ name: 'browser-agent', version: '1' });
  const transport = new StreamableHTTPClientTransport(
    new URL('http://localhost:3210/mcp'),
    { requestInit: { headers: { Authorization: `Bearer ${secret}` } } },
  );
  try {
    await client.connect(transport);
    expect(
      (await client.listTools()).tools.some(
        (tool) => tool.name === 'moderation_ban',
      ),
    ).toBe(true);
    let notified = false;
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notified = true;
    });
    await page.getByLabel('moderation', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Save categories' }).click();
    await expect.poll(() => notified).toBe(true);
    expect(
      (await client.listTools()).tools.some(
        (tool) => tool.name === 'moderation_ban',
      ),
    ).toBe(false);
    await page.getByLabel('features', { exact: true }).check();
    await page.getByRole('button', { name: 'Save categories' }).click();
    await expect
      .poll(async () =>
        (await client.listTools()).tools.some(
          (t) => t.name === 'list_features',
        ),
      )
      .toBe(true);
    await client.callTool({
      name: 'configure_module',
      arguments: {
        guild: '10',
        module_id: 'logging',
        config: { channelId: '98' },
      },
    });
    const enabled = await client.callTool({
      name: 'set_feature_enabled',
      arguments: {
        guild: '10',
        feature_id: 'logging.messageEdited',
        enabled: true,
      },
    });
    expect(enabled.isError).toBeFalsy();
    await page.getByRole('link', { name: 'Servers', exact: true }).click();
    await page
      .getByRole('link')
      .filter({ has: page.getByRole('heading', { name: 'Server A' }) })
      .click();
    await expect(page.locator('.server-header')).toContainText('Server A');
    const loggingCard = page.locator('.module-card').filter({
      has: page.getByRole('heading', { name: 'Logging', exact: true }),
    });
    await expect(loggingCard).toContainText('1 of 7 features on');
    await expect(loggingCard).toContainText('Degraded');
    await client.callTool({
      name: 'set_module_enabled',
      arguments: { guild: '10', module_id: 'logging', enabled: false },
    });
    await expect(
      page.getByRole('switch', { name: 'Logging enabled', exact: true }),
    ).not.toBeChecked({ timeout: 8000 });
    await page
      .getByRole('switch', { name: 'Logging enabled', exact: true })
      .click();
    await expect(
      page.getByRole('switch', { name: 'Logging enabled', exact: true }),
    ).toBeChecked();

    await page.getByRole('link', { name: 'Configure Logging →' }).click();
    await expect(page.getByLabel('Log channel', { exact: false })).toHaveValue(
      '98',
    );
    await page.getByLabel('Log channel', { exact: false }).selectOption('99');
    const ignored = page.locator('.multi-picker').filter({
      has: page.getByRole('combobox', {
        name: 'Ignored channels',
        exact: true,
      }),
    });
    await expect(ignored).toContainText(
      'No channels selected. No channels are ignored.',
    );
    await ignored.getByRole('combobox').selectOption('98');
    await ignored.getByRole('combobox').selectOption('99');
    await expect(ignored.locator('.selection-pill')).toHaveCount(2);
    await ignored
      .getByRole('button', { name: 'Remove # activity · Text', exact: true })
      .click();
    await expect(ignored.locator('.selection-pill')).toHaveCount(1);
    await expect(ignored.getByRole('combobox')).toHaveValue('');

    await page
      .locator('form[data-form="module"]')
      .getByRole('button', { name: 'Save settings' })
      .click();
    await expect(page.getByLabel('Log channel', { exact: false })).toHaveValue(
      '99',
    );
    await page.reload();
    await expect(
      ignored.getByRole('button', {
        name: 'Remove # logs · Text',
        exact: true,
      }),
    ).toBeVisible();
    await expect(ignored.locator('input[type="hidden"]')).toHaveValue('98');
    await ignored
      .getByRole('button', { name: 'Remove # logs · Text', exact: true })
      .click();
    await expect(ignored).toContainText(
      'No channels selected. No channels are ignored.',
    );
    await page
      .locator('form[data-form="module"]')
      .getByRole('button', { name: 'Save settings' })
      .click();
    await expect(page.locator('#main')).not.toHaveAttribute('aria-busy');
    await page
      .getByRole('switch', { name: 'Message deletes enabled', exact: true })
      .click();
    await expect(
      page.getByRole('switch', {
        name: 'Message deletes enabled',
        exact: true,
      }),
    ).toBeChecked();
    await page
      .getByRole('navigation', { name: 'Modules' })
      .getByRole('link', { name: 'Overview' })
      .click();
    await expect(loggingCard).toContainText('2 of 7 features on');
    await page
      .getByRole('switch', { name: 'Logging enabled', exact: true })
      .click();
    await expect(
      page.getByRole('switch', { name: 'Logging enabled', exact: true }),
    ).not.toBeChecked();
    await page.reload();
    await expect(
      page.getByRole('switch', { name: 'Logging enabled', exact: true }),
    ).not.toBeChecked();
    await expect(loggingCard).toContainText('2 of 7 features on');
    await page.getByRole('link', { name: 'Configure Logging →' }).click();
    await expect(page.locator('.feature-card').first()).toContainText(
      'Suspended · module is off',
    );
    await expect(
      page.getByRole('switch', { name: 'Message edits enabled', exact: true }),
    ).toBeChecked();
    const result = await client.callTool({
      name: 'list_features',
      arguments: { guild: '10' },
    });
    const module = JSON.parse((result.content as { text: string }[])[0].text)
      .result[0].modules[0];
    expect(module.enabled).toBe(false);
    expect(module.features[0]).toMatchObject({
      enabled: true,
      effectiveEnabled: false,
    });
    await page
      .getByRole('switch', { name: 'Logging enabled', exact: true })
      .click();
    await expect(
      page.getByRole('switch', { name: 'Logging enabled', exact: true }),
    ).toBeChecked();
    await page
      .getByRole('navigation', { name: 'Modules' })
      .getByRole('link', { name: 'Members', exact: true })
      .click();
    await page.getByText('Configure Autorole', { exact: true }).click();
    const roles = page.locator('.multi-picker').filter({
      has: page.getByRole('combobox', {
        name: 'Assigned roles',
        exact: true,
      }),
    });
    await expect(roles).toContainText(
      'No roles selected. No roles will be assigned.',
    );
    await roles.getByRole('combobox').selectOption('88');
    await roles.getByRole('combobox').selectOption('89');
    await expect(roles.locator('.selection-pill')).toHaveCount(2);
    await roles
      .getByRole('button', { name: 'Remove Helper', exact: true })
      .click();
    await expect(roles.locator('.selection-pill')).toHaveCount(1);

    await page
      .getByRole('switch', { name: 'Autorole enabled', exact: true })
      .click();
    await expect(
      page.getByRole('switch', { name: 'Autorole enabled', exact: true }),
    ).toBeChecked();
    await page.reload();
    await expect(
      roles.getByRole('button', { name: 'Remove Member', exact: true }),
    ).toBeVisible();
    await expect(roles.locator('input[type="hidden"]')).toHaveValue('88');
    await expect(roles.getByRole('combobox')).toHaveValue('');
    await page
      .getByRole('combobox', { name: 'Server', exact: true })
      .selectOption('#bots/hello-bot/servers/20/members');
    await expect(page.locator('.server-header')).toContainText('Server B');
    await expect(
      page.getByRole('switch', { name: 'Autorole enabled', exact: true }),
    ).not.toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('combobox', { name: 'Module', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Modules' }),
    ).not.toBeVisible();
    await page
      .getByRole('combobox', { name: 'Module', exact: true })
      .selectOption('#bots/hello-bot/servers/20/logging');
    await expect(
      page.getByRole('heading', { name: 'Logging', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/#bots/hello-bot/audit');
    const audit = page.getByRole('region', { name: 'Audit entries' });
    await expect(audit).toBeVisible();
    expect(
      await audit.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await audit.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(
      await audit.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
    const added = await page.request.post('/api/admin/bots', {
      headers: { Origin: 'http://localhost:3210' },
      data: { slug: 'other', token: 'other-token', categories: ['messages'] },
    });
    expect(added.ok()).toBe(true);
    const listed = await client.callTool({ name: 'list_bots', arguments: {} });
    expect(JSON.stringify(listed)).not.toContain('other');
    const hidden = await client.callTool({
      name: 'api_request',
      arguments: { bot: 'other', method: 'GET', path: '/users/@me' },
    });
    expect(hidden.isError).toBe(true);
    expect(JSON.stringify(hidden)).toContain('Bot not found.');
  } finally {
    await client.close();
  }

  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Server-wide read-only mode').check();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByLabel('Server-wide read-only mode')).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Keys', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'API keys' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
