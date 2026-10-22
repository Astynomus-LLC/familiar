# Hosting Familiar

## Keep the master secret

**Back up `MASTER_SECRET` separately from `/data`. Losing it makes stored bot tokens
unrecoverable. You must re-enter every bot token.** The OAuth client secret is also
encrypted. If it can no longer be decrypted, Familiar prints a new setup code so
you can restore OAuth credentials. Existing ownership and allowlist entries remain.

Generate a secret with `openssl rand -hex 32`. Keep it unchanged across upgrades and
restarts. Do not commit `.env`, the database, or secrets to source control.

## Docker Compose

Requires Docker Compose, a domain pointed at the host, and inbound ports 80 and 443.

1. Copy `.env.example` to `.env`.
2. Set `DOMAIN` to the hostname, `PUBLIC_URL` to its HTTPS URL, and `MASTER_SECRET`
   to your generated secret. `PORT` defaults to 3000.
3. Run `docker compose up -d`.
4. Read `docker compose logs app` for the one-time setup code.
5. Open `PUBLIC_URL` and enter that code. It is consumed on use. If you lose the
   setup browser session before claiming ownership, restart the app for a new code.
6. Enter your bot application's ID and OAuth client secret. Register the exact
   redirect URL shown in the wizard under OAuth2 in the Discord developer portal.
7. Sign in to claim ownership, add your bot token, select categories, and generate
   a scoped API key. Save the key and client configuration before leaving the page.

Caddy is included by default and obtains HTTPS certificates automatically. Its
certificate state is persisted in its own volumes. The app runs as the unprivileged
`node` user; its SQLite file lives at `/data/familiar.sqlite`. Configure one app
replica per database. MCP sessions and web login sessions live in that process.

The image is `ghcr.io/astynomus-llc/familiar:latest`. Before the first published release,
use `docker compose up --build -d` from a checkout. No bot token is required to boot
or open the setup wizard. A valid Discord application and token are needed to
complete real setup.

Only four environment settings are used: `PORT`, `PUBLIC_URL`, `DOMAIN`, and
`MASTER_SECRET`. Bot tokens, keys, access roles, categories, defaults, and read-only
mode are configured in the UI. The public URL must be an origin with no path prefix.

## Existing reverse proxy or tunnel

Remove the Caddy service and its volumes from your compose file. Keep the app's
loopback-bound port and point your proxy at `http://127.0.0.1:3000`. Preserve streaming
responses and the `Authorization`, `Mcp-Session-Id`, and `MCP-Protocol-Version`
headers. Set `PUBLIC_URL` to the externally visible HTTPS origin, not the upstream
address. The UI's OAuth redirects, origin checks, cookies, and client snippets use it.

## Updates and backups

```sh
docker compose pull && docker compose up -d
```

Back up the entire app data volume while the app is stopped; SQLite uses WAL files
alongside the main database. Keep a separate protected copy of the master secret.
Restore both together. Do not copy only the live `.sqlite` file and omit its WAL.
Use a pinned image version if you need controlled upgrades.

## Laptop / npx

Requires Node 24 or newer. From a persistent working directory:

```sh
export MASTER_SECRET='<your generated secret>'
npx @astynomus/familiar --stdio
```

The SQLite file lives in `./data/familiar.sqlite`, relative to the working directory.
The UI is at `http://localhost:3000`; setup codes and logs go to stderr. Stdout is
reserved for MCP. Run one Familiar process per data directory. Configure your MCP
client to launch this command in the same working directory on each run. Do not
start a second app process against the same database: live sessions and bot clients
are process-local.

For clients that need a command configuration:

```json
{
  "mcpServers": {
    "familiar": {
      "command": "npx",
      "args": ["-y", "@astynomus/familiar", "--stdio"],
      "env": { "MASTER_SECRET": "<your generated secret>" }
    }
  }
}
```

Protect this client config like any other secret. Stdio is intentionally keyless
and trusted locally. Use HTTP with a scoped API key when you need identity or
capability restrictions.

## Connect an agent to the running server

Generate a scoped key in **Keys**, then choose **Codex**, **Claude Code**,
**OpenCode**, or **Other HTTP client** on the result screen. Each option includes
this instance's URL and the new key in the client's required format. Save it before
leaving: existing keys cannot be retrieved, because Familiar stores only hashes.

- Codex: merge the TOML into `~/.codex/config.toml` (or
  `$CODEX_HOME/config.toml`), replacing any old Familiar section. The generated
  `http_headers` includes authentication directly; do not put a key into
  `bearer_token_env_var`, which expects a variable name. The optional launch
  command starts one CLI session with the same settings without editing a file.
- Claude Code: run the generated user-scope install command in Bash or Zsh.
  Remove an existing Familiar entry at that scope before adding its replacement.
  This option is specifically for Claude Code.
- OpenCode: merge the generated JSON into `~/.config/opencode/opencode.json`.
  It uses a remote server with an Authorization header and OAuth disabled.

Keep configurations and commands private: they include the API key. Preserve
unrelated settings when merging, and check for project-level overrides. Localhost
URLs work only when the client runs on the Familiar host.

Use **Check connection** to verify authentication and tool discovery from the
browser. This does not inspect the agent's configuration. Fully restart the agent
and ask it to call `list_bots` to verify its connection. If authentication fails,
replace the old client entry; if no tools are listed, check the bot scope and
categories. An unknown client status label alone does not establish a failed tool
connection.

Client format references: [Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[Claude Code](https://code.claude.com/docs/en/mcp), and
[OpenCode](https://opencode.ai/docs/mcp-servers/).

## Offline bots and token changes

Invalid tokens are rejected on save. A failed gateway login leaves the bot offline
with a visible error and a concise log entry; Familiar keeps serving the UI and
MCP. REST requests may still work when the gateway is unavailable. Check Discord
permissions, connectivity, and application settings, then replace the token in Bots
or restart the app. Familiar requests only the Guilds and Guild Voice States gateway
intents; REST operations that require privileged access must be enabled for the bot
in the Discord developer portal.

## Release namespace

The release workflow publishes `ghcr.io/astynomus-llc/familiar` under the
`Astynomus-LLC` organization that owns the repository. It authenticates with
`github.actor` and the built-in `GITHUB_TOKEN`, using the workflow's `packages: write`
permission. Publication and public package visibility must be verified by the
maintainer before announcing installs.
