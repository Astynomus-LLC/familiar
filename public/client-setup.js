// Keep credentials literal: no client-side environment variable setup is required.
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export function clientSetup(generatedKey, client = 'codex') {
  const { url, headers } = generatedKey.config.mcpServers.familiar;
  const json = (value) => JSON.stringify(value, null, 2);
  const codex = `{ url = ${JSON.stringify(url)}, http_headers = { Authorization = ${JSON.stringify(headers.Authorization)} } }`;
  const setups = {
    codex: {
      name: 'Codex',
      instructions:
        'Add this to ~/.codex/config.toml (or $CODEX_HOME/config.toml). Replace any existing [mcp_servers.familiar] section, including its old bearer_token_env_var setting. Keep your other settings.',
      config: `[mcp_servers.familiar]\nurl = ${JSON.stringify(url)}\nhttp_headers = { Authorization = ${JSON.stringify(headers.Authorization)} }`,
      command: `codex -c ${shellQuote(`mcp_servers.familiar=${codex}`)}`,
      commandHelp:
        'Try it now in Bash or Zsh: this launches Codex with Familiar for this session only. Save the config above for future sessions.',
      verify:
        'Fully exit and relaunch Codex after saving. Open /mcp, then ask: “Use Familiar to call list_bots.”',
    },
    claude: {
      name: 'Claude Code',
      instructions:
        'Run this in Bash or Zsh to add Familiar for your user account. If Familiar already exists, run claude mcp remove familiar --scope user first. Check /mcp for project entries that may override it.',
      config: `claude mcp add --transport http --scope user --header ${shellQuote(`Authorization: ${headers.Authorization}`)} familiar ${shellQuote(url)}`,
      verify:
        'Restart Claude Code, open /mcp, and ask: “Use Familiar to call list_bots.” This setup is for Claude Code, not Claude Desktop.',
    },
    opencode: {
      name: 'OpenCode',
      instructions:
        'Merge this into ~/.config/opencode/opencode.json, preserving your other settings. Replace an existing mcp.familiar entry. A project opencode.json can override your user settings.',
      config: json({
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          familiar: {
            type: 'remote',
            url,
            enabled: true,
            oauth: false,
            headers,
          },
        },
      }),
      verify:
        'Restart OpenCode and ask: “Use Familiar to call list_bots.” Authentication is already included; no OAuth login is needed.',
    },
    other: {
      name: 'Other HTTP client',
      instructions:
        'Use this with clients that support mcpServers JSON and HTTP headers. Otherwise enter the URL and Authorization header in your client’s MCP settings. Check your client’s required format.',
      config: json(generatedKey.config),
      verify:
        'Restart the client and ask it to call Familiar’s list_bots tool.',
    },
  };
  return setups[client] ?? setups.codex;
}

export async function checkConnection(generatedKey) {
  const { url, headers: auth } = generatedKey.config.mcpServers.familiar;
  let sessionId;
  let protocol = '2025-03-26';
  const headers = () => ({
    ...auth,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(sessionId
      ? { 'Mcp-Session-Id': sessionId, 'MCP-Protocol-Version': protocol }
      : {}),
  });
  async function rpc(body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: window.AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (response.status === 401)
        throw new Error(
          'API key rejected. Generate a new key and replace the client configuration.',
        );
      throw new Error(
        `MCP connection failed (HTTP ${response.status}). Check the server URL and logs.`,
      );
    }
    sessionId = response.headers.get('mcp-session-id') ?? sessionId;
    if (response.status === 202) return;
    const text = await response.text();
    const message = response.headers
      .get('content-type')
      ?.includes('text/event-stream')
      ? text
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => JSON.parse(line.slice(5)))
          .find((item) => item.id === body.id)
      : JSON.parse(text);
    if (!message || message.error)
      throw new Error(message?.error?.message ?? 'Unexpected MCP response.');
    return message.result;
  }
  try {
    const initialized = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: protocol,
        capabilities: {},
        clientInfo: { name: 'Familiar connection check', version: '0.1.0' },
      },
    });
    protocol = initialized.protocolVersion;
    await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const result = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    return result.tools.length;
  } finally {
    if (sessionId)
      await fetch(url, {
        method: 'DELETE',
        headers: headers(),
        signal: window.AbortSignal.timeout(5000),
      }).catch(() => {});
  }
}
