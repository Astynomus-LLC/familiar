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
  await expect(page.getByLabel('moderation', { exact: true })).toBeChecked();
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
    const enabled = await client.callTool({
      name: 'set_feature_enabled',
      arguments: {
        guild: '10',
        feature_id: 'logging',
        enabled: true,
        config: { channelId: '99' },
      },
    });
    expect(enabled.isError).toBeFalsy();
    await client.callTool({
      name: 'configure_feature',
      arguments: {
        guild: '10',
        feature_id: 'logging',
        config: { channelId: '98' },
      },
    });
    await page.getByRole('link', { name: 'Servers and features →' }).click();
    await page.getByText('Server A (10)', { exact: true }).click();
    const logging = page.locator(
      'form[data-guild="10"][data-feature="logging"]',
    );
    await expect(logging.getByLabel('channelId', { exact: true })).toHaveValue(
      '98',
    );
    await expect(page.locator('details').first()).toContainText(
      'needs GuildMembers',
    );
    await logging.getByLabel('Enabled', { exact: true }).uncheck();
    await logging.getByRole('button', { name: 'Save feature' }).click();
    await expect
      .poll(async () => {
        const result = await client.callTool({
          name: 'get_feature_config',
          arguments: { guild: '10', feature_id: 'logging' },
        });
        return JSON.parse((result.content as { text: string }[])[0].text).result
          .enabled;
      })
      .toBe(false);
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
