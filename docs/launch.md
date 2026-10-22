# Launch checklist

These are release tasks, not features in the server. They require maintainer
accounts, a real Discord application, or public distribution access.

- Resolve the `Astynomus-LLC` repository / `astynomus` image namespace discrepancy.
  Confirm the GitHub organization profile links to Astynomus's other products.
- Run the wizard with a real Discord app and bot, then connect a real MCP client.
  Verify the bot name, message send, category notification, and key revocation.
- Record a 30-second GIF showing Familiar's UI and Claude managing a test Discord
  server. Add it to the README. Do not present mocked browser screenshots as a
  real Discord or Claude session.
- Publish `@astynomus/discord-mcp` publicly on npm with `npm publish --access public`.
  Inspect `npm pack --dry-run` first. Verify `npx @astynomus/discord-mcp --stdio`
  from a clean directory after publication.
- Publish a GitHub release. The release workflow tests and publishes multi-platform
  images to `ghcr.io/astynomus/familiar`. Make the package public and verify pulls
  without authentication.
- Test a clean public-host deployment with DNS and Caddy certificate issuance.
- Submit to the official MCP registry, Smithery, Glama, awesome-mcp lists, and
  PulseMCP using their current submission processes.
- Post Show HN and share in the Discord developer community.

No registry submissions, announcements, npm publication, GitHub releases, or org
profile changes are performed by local build/test commands.
