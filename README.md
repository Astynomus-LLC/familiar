# Familiar

Your Discord bots, available to your agent. Self-hosted, open source, built by
[Astynomus](https://astynomus.com).

Familiar runs an MCP server, a web admin UI, and a SQLite config store in one
process. Bring your own bot tokens. Run a handful of bots with separate identities,
category packs, and scoped keys. Nothing phones home.

![Familiar dashboard, with mocked Discord data](docs/dashboard.png)

## Install

**Back up `MASTER_SECRET` separately from your data volume. Losing it makes stored
bot tokens unrecoverable; you must re-enter them.** Generate it with
`openssl rand -hex 32` and keep it unchanged across restarts.

**Docker Compose (primary):** copy `.env.example` to `.env`, set `DOMAIN`,
`PUBLIC_URL`, and `MASTER_SECRET`, then:

```sh
docker compose up -d
```

Caddy is included and handles automatic HTTPS. Open your domain and enter the
one-time code printed by `docker compose logs app`. The wizard walks through
ownership, adding a bot, choosing categories, and generating a key. Only bootstrap
settings live in the environment; everything else is configured in the UI.

**Laptop / stdio (Node 24+):**

```sh
MASTER_SECRET='<your generated secret>' npx @astynomus/familiar --stdio
```

The UI is at `http://localhost:3000`; the database is in `./data`. Stdio trusts the
local process and needs no API key. HTTP MCP at `/mcp` requires a scoped bearer key.
Use one persistent working directory and one process per instance.

The npm package is `@astynomus/familiar`; the image is
`ghcr.io/astynomus-llc/familiar`. These install commands require the first public
release. Until then, use `npm ci && npm run build && npm start` from this checkout,
or `docker compose up --build -d`.

See [hosting](docs/hosting.md) for setup, proxy configuration, backups, and updates.

## What your agent gets

- Per-session active bot, defaulting to the configured default when in scope.
  Every tool accepts a one-call `bot` override. Every result includes its acting
  bot's slug and name.
- Core orientation tools: `whoami`, `list_bots`, and `set_active_bot`.
- Typed tools for messages, channels, threads, members, roles, moderation,
  webhooks, emojis and stickers, scheduled events, automod, invites, audit log,
  application commands, guilds, users, and voice management.
- `api_request` for Discord REST endpoints without a typed wrapper. It supports
  query strings, JSON bodies, and base64 multipart uploads. Voice audio streaming
  is excluded; joining and managing voice channels is supported.

Category changes and active-bot switches emit MCP `notifications/tools/list_changed`
without reconnecting. Each category is a module with a manifest and tool definitions;
[the registry](src/tools/registry.ts) is the only registration point.

Raw calls use the acting bot's token against Discord API v10. Discord permissions,
privileged-access requirements, and rate limits still apply. Endpoints requiring
user OAuth credentials cannot be made bot-accessible by an MCP server.

## Keys and safety

Keys can cover all bots or a subset, with optional read-only and category ceilings.
Out-of-scope Familiar bots are absent from `list_bots`; switching or overriding to
one returns the same “not found” result as an unknown slug. A single-bot key fixes
identity to that bot. Revocation closes its live sessions immediately.

Core and raw API remain visible. With a category ceiling, typed packs are intersected
with the bot's packs, and raw calls require an explicit `raw_api` grant. Granting raw
API gives full REST reach under the key's bot scope and read-only setting; it is not
limited to the other typed categories. Without that grant, raw calls are rejected.

Destructive typed tools require a confirmation code bound to the exact call, bot,
and session. Codes expire after two minutes and work once. All raw mutations use the
same confirmation flow, because an arbitrary REST route cannot safely be classified
as nondestructive. Server-wide and per-key read-only mode block every mutation.
The local audit log records attempted mutations, confirmation requests, and outcomes
without recording message bodies or tokens.

Bot tokens and the OAuth client secret use AES-256-GCM encryption at rest. API keys
are random verify-only secrets stored as SHA-256 hashes and displayed only once.
Owners control access and ownership; members can manage the other configuration.

## Tool-surface comparison

Based on each project's published README, checked October 22, 2026. “Not documented”
means the README makes no such claim, rather than a claim about all implementation
internals. Sources: [SaseQ/discord-mcp](https://github.com/SaseQ/discord-mcp#readme)
and [v-3/discordmcp](https://github.com/v-3/discordmcp#readme).

| Surface                           | Familiar                                   | SaseQ/discord-mcp                                                                            | v-3/discordmcp           |
| --------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------ |
| Messages                          | Read, send, edit, delete, bulk delete, pin | Messages, DMs, reactions                                                                     | Send and read            |
| Server management                 | All resource categories listed above       | Channels, members, roles, moderation, webhooks, voice/stage, events, invites, forums, emojis | Server/channel discovery |
| Unwrapped REST endpoints          | Raw API passthrough, including multipart   | Not documented                                                                               | Not documented           |
| Multiple bot identities           | Per-session identity and per-call override | One configured token                                                                         | One configured token     |
| Scoped keys and category controls | Web UI; live tool-list updates             | Not documented                                                                               | Not documented           |

## Development

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:ui
```

Tests mock Discord and OAuth. They cover scope hiding, identity resolution, live HTTP
notifications, encryption, confirmations, read-only enforcement, approval boundaries,
and the browser setup flow. No real Discord token is required. The dashboard image
above uses the same mocked data; a real Discord/Claude demo is a launch task.

The code is plain TypeScript. Storage, bot connections, category definitions, MCP
transports, and web administration have separate modules. No plugin loader, hosted
multi-tenancy, agent-defined event rules, or voice-audio transport is included.

## License and launch

AGPLv3. [LICENSE](LICENSE) is unchanged. Copyright Astynomus LLC.

[Launch checklist](docs/launch.md) tracks publication, the live demo, and directory
submissions. [Built by Astynomus](https://astynomus.com) — see our other products.
