# Multi-user Google Drive + MEGA Rclone onboarding (staging implementation)

Status: **development branch only**. This is not production deployment or Google's app verification. Scope includes Google Drive OAuth and **MEGA browser-only credential enrollment**, with multiple independent cloud remotes per authenticated NestNyx user. Existing private Rclone remotes remain untouched. Local-folder syncing is not in this release.

## Runtime isolation

- One shared Rclone **binary**, never a shared Rclone **configuration**.
- A NestNyx OAuth subject is the only source of owner identity (taken from a verified MCP JWT, not tool arguments).
- PostgreSQL `nyx_tenant_rclone` keys each connection by immutable UUID and owner ID, with unique owner/name and one optional MAIN Drive per owner.
- Each connection's Google OAuth token or MEGA login/session material is AES-256-GCM encrypted with additional authenticated data `[owner,id,provider]` and a server-managed encryption key.
- Each read/write probe creates an ephemeral 0700 directory and 0600 config containing exactly one remote named `tenant`, runs bounded Rclone with a restricted child environment, discards output, then deletes the directory.
- One probe per owner at a time, four across the server instance; database-enforced hourly budgets apply. Distributed concurrency/admission and comprehensive quota metrics remain a production release blocker.
- Private shared `RCLONE_CONFIG_PATH` / `RCLONE_CONFIG_B64` and legacy shared-root routes cannot run in public connector mode.
- MAIN requires a **connected Google Drive** with a successful write probe in the past 15 minutes. Verification creates and removes a randomly named temporary folder. The user must explicitly invoke the test.

## Environment variables

These are configuration **names only**: never place their values in this repository, GitHub issues, Head/Body or ChatGPT prompts.

- `NYX_DEPLOYMENT_MODE=public`
- `NYX_PUBLIC_CONNECTORS_ENABLED=true`
- `NYX_TENANT_STORAGE_ENABLED=true` (default disabled)
- `NYX_STORAGE_ENCRYPTION_KEY`: base64 of 32 random bytes, preserved across deploys, held only in secret storage, with backed-up key rotation procedures
- `DATABASE_URL`: tenant metadata/encrypted-token store, minimally privileged, private TLS connection
- `NYX_GOOGLE_CLIENT_ID`: registered NestNyx Google Cloud OAuth **web** client
- `NYX_GOOGLE_CLIENT_SECRET`: web-client secret, server only
- `NYX_PUBLIC_URL`: exact HTTPS origin configured in Google OAuth Authorized redirect URIs; callback is `/connect/google-drive/callback`
- `RCLONE_BINARY`: server-installed trusted binary; do not use third-party wrappers or arbitrary shell

Never enable public mode on the existing private operator deployment. Use a distinct staging environment with separate data/credentials and separate Google Cloud OAuth project.

## Flow

1. Sign in with the NestNyx MCP OAuth provider (existing Auth0/JWT flow).
2. Open Connections Panel and enter a display name under Google Drive.
3. `nyx_storage_begin_google` returns an official `accounts.google.com/o/oauth2/v2/auth` authorization URL. The browser performs OAuth authorization code + PKCE + one-time state.
4. Google redirects to the NestNyx callback, which exchanges code server-side, independently verifies user identity and the `drive.file` scope, and encrypts the received refresh token.
5. Back in NestNyx, refresh `nyx_storage_connections`, explicitly `nyx_storage_probe` for `read` and `write`, then choose `nyx_storage_set_main`.
6. You may add another Google account to the **same** NestNyx user, including multiple connections to the same Google identity (subject to Google's refresh-token behavior).
7. Different NestNyx authenticated users see **only their own** connections. `nyx_storage_disconnect` removes one local connection's authorization; it does not call Google's provider-wide revocation endpoint, because doing so could revoke authorization for other remotes of the same Google identity.

MCP tools: `nyx_storage_connections`, `nyx_storage_begin_google`, `nyx_storage_begin_mega`, `nyx_storage_rename`, `nyx_storage_probe`, `nyx_storage_set_main`, `nyx_storage_disconnect`.

## Permission boundary and limitations

The OAuth scope is `drive.file`, which limits the app to files it creates and files explicitly opened/selected for the app. It is **not** full Google Drive access; it is not a general Google Drive browser or arbitrary folder sync. Google OAuth consent branding and verification must be completed before public launch.

This build does **not** include personal Head/Body/Footer provisioning, arbitrary file transfers or bidirectional sync, a local companion, cross-account migrations, manual Google scope escalation, or automated deployment. MEGA credentials are collected directly on a NestNyx-hosted HTTPS form and encrypted; they must never be entered in ChatGPT or exposed through MCP tools. Do not claim those work.

## Release gates

- CI pass, independent code/security review, callbacks/PKCE/replay checks, two real NestNyx users connecting at least two independent Google identities, and negative cross-owner tests (including forged connection IDs).
- Validate access-token refresh, concurrent refresh behavior, optional zero-trust job isolation, stale/revoked grants, and safe cleanup on timeout/killed worker.
- Verify `drive.file` semantics and Rclone lifecycle with real Google OAuth. Confirm quota/rate/size controls, monitoring and manual spend configuration.
- Register domain, privacy policy and branding, Google OAuth verification as required. Never request sensitive full-drive scopes without explicit review.
- Only after release approval, merge to production and deploy via approved manual workflow. No automatic enablement or migration of eight private operator remotes.

## MEGA enrollment (not OAuth)

MEGA's Rclone backend requires a MEGA email + password and optionally a current six-digit 2FA code. **MEGA does not provide a native OAuth plugin flow here**. The user must understand that the NestNyx host, not MEGA, receives these credentials. Do not disguise the form as MEGA's own login. The browser form explicitly explains this.

1. In the NestNyx Connections Panel, choose `MEGA` → `Connect MEGA`. `nyx_storage_begin_mega` creates a separate pending MEGA connection under the verified OAuth owner, and returns a one-use HTTPS URL (`/connect/mega?ticket=...`).
2. The MEGA email, password and optional 2FA are entered only on the NestNyx-hosted web form. The browser sends them directly as an HTTPS POST to `/connect/mega/submit`. Origin check, one-time ticket, 10-minute expiry, no-store, no-referrer, deny iframe, form-action same origin and bounded input apply.
3. NestNyx sends the password by stdin to a subprocess running `rclone obscure -`, so the raw password never appears in a shell command line. Rclone obscuring alone is **not encryption**; NestNyx stores the resulting obscured pass plus account email and any MEGA session/master keys using AES-256-GCM with per-owner authenticated data. The 2FA code is **never stored**.
4. The connection becomes active only if an isolated Rclone root read succeeds. MEGA backend-generated `session_id` and `master_key` are collected from the isolated config after login and encrypted for reuse to reduce repeated logins and throttling.
5. MEGA can still throttle or temporarily block repeated logins, so the per-owner budgets and low-frequency probes are important. Do not run frequent or concurrent MEGA probes. Browser account initialization may be necessary before the initial Rclone login, per upstream documentation.
6. The authorized owner can subsequently list, rename, probe and disconnect **their own** MEGA remote. MEGA cannot become MAIN in this onboarding contract; MAIN remains a write-verified Google Drive.

**Important release blockers:** verify real MEGA login and 2FA session reuse, rate limits, session revocation/reconnect, acceptable handling of credentials within the web server, and test two isolated users/MEGA accounts. Do not enable public tenant storage until this is verified.

Upstream documentation: https://rclone.org/mega/ and https://rclone.org/commands/rclone_obscure/
