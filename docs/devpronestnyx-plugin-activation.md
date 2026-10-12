# DevProNestNyx — separate development MCP app

Status: **source prepared in YaRoute-Dev only**. A GitHub commit or green CI is
NOT evidence of a live Heroku service, OAuth flow or ChatGPT plugin installation.

## Hard boundaries

- Source: existing `YaRoute-Dev` `main` branch. No new code repo needed.
- Production source: `YaRoute` `master`. Do **not** push to, rewrite or redeploy it.
- New Heroku app: choose a separate app slug (e.g. `devpro-nestnyx-<unique>`).
- New MCP origin: `https://<exact-new-heroku-host>/mcp`, confirmed only after deployment.
- ChatGPT plugin display name: **DevProNestNyx**, a separately added custom MCP app.
- Existing **DevNestNyx/NestNyx** connection remains installed and unchanged.
- DEV uses a separate PostgreSQL database, encryption key, OAuth audience/resource,
  app callback and **test-scoped** rclone remotes. Never clone production runtime
  secrets, refresh tokens or DATABASE_URL. Do not expose prod storage writes.
- Owner allow-list and private mode remain mandatory until full tenant isolation
  and end-to-end multi-user tests are proven. Do not advertise public rollout.

## Manual activation (secret-free)

1. In Heroku, create a **new** app with a unique name. Connect **this** DEV
   repository and the `main` branch. Disable automatic deployments and review
   whether deployment via Heroku GitHub integration is enabled.
2. Configure this new app's own private config vars. The root `app.json`
   describes the required values; supply `NYX_PUBLIC_URL` with this NEW origin.
   Set `NYX_SERVICE_NAME=DevProNestNyx`,
   `NYX_DEPLOYMENT_MODE=private`, `NYX_PUBLIC_CONNECTORS_ENABLED=false`
   and explicitly allow only the authorized private OAuth subjects.
3. Configure a **separate DEV API/resource audience** with your OAuth provider.
   You may reuse the provider/tenant if desired, but tokens must be scoped to
   the distinct DEV audience. Use proper JWKS validation and the DEV origin in
   authorization metadata. If the provider cannot issue separate-audience tokens,
   do not connect it until that is configured.
4. Provision a **separate DEV database** and a new encryption key. Set only
   DEV/test rclone config and storage-root restrictions. Never copy PROD DB,
   encryption keys or production rclone config into this app.
5. For the in-app GitHub Connections Panel, create or configure a GitHub App
   with callback URL `https://<new-dev-host>/connect/github/callback`.
   Install it on **selected DEV repositories only**, with minimal permissions.
   Keep separate app credentials private. No workflow/Actions-write/admin,
   billing or deployments permission.
6. Deploy manually. Verify `GET /health` on the *new* host returns
   `ok: true`, `service: DevProNestNyx` and the expected DEV commit.
   Verify `/.well-known/oauth-protected-resource` advertises exactly this
   new `/mcp` resource and DEV OAuth issuer; unauthenticated `/mcp`
   must challenge with 401. Validate an actual authorized MCP initialize and
   one read-only tool invocation with the proper DEV audience and subject.
7. In ChatGPT **Settings → Plugins** (or **Apps/Connectors**, depending on UI),
   add a **new custom MCP** connection named `DevProNestNyx` pointing to the
   verified new `/mcp` URL. Complete OAuth and grant only the requested
   safe permissions. Do not replace, edit or reconnect the existing plugin.
8. Check both plugin names appear independently. Call `nyx_capabilities`
   and `nyx_head_status` against the new connection, verify the service
   identity, GitHub selected DEV repos, and check the existing connector still
   functions. Log the verified GitHub commit and test receipts.
9. Subsequent DEV feature promotions go to `YaRoute` via reviewed PRs only;
   production merge/deploy still requires owner approval.

## Explicitly not automated by a repository commit

This repository cannot create Heroku applications, issue OAuth credentials,
install a custom ChatGPT plugin, connect a user's ChatGPT account or verify
live provider setup. Those actions require an authenticated owner workflow.
The finished app is **not connected** until all relevant steps above pass.
