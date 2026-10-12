# Multi-user Google Drive Rclone onboarding (staging implementation)

Status: **development branch only**. This is not production deployment or Google's app verification. Scope is Google Drive OAuth with distinct authenticated NestNyx users and multiple remotes per user. Existing private Rclone remotes remain untouched. MEGA per-user onboarding and local-folder syncing are not part of this release.

## Runtime isolation

- One shared Rclone **binary**, never a shared Rclone **configuration**.
- A NestNyx OAuth subject is the only source of owner identity (taken from a verified MCP JWT, not tool arguments).
- PostgreSQL `nyx_tenant_rclone` keys each connection by immutable UUID and owner ID, with unique owner/name and one optional MAIN Drive per owner.
- Each connection's OAuth token is AES-256-GCM encrypted with additional authenticated data `[owner,id,provider]` and a server-managed encryption key.
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

MCP tools: `nyx_storage_connections`, `nyx_storage_begin_google`, `nyx_storage_rename`, `nyx_storage_probe`, `nyx_storage_set_main`, `nyx_storage_disconnect`.

## Permission boundary and limitations

The OAuth scope is `drive.file`, which limits the app to files it creates and files explicitly opened/selected for the app. It is **not** full Google Drive access; it is not a general Google Drive browser or arbitrary folder sync. Google OAuth consent branding and verification must be completed before public launch.

This build does **not** include personal Head/Body/Footer provisioning, arbitrary file transfers or bidirectional sync, MEGA credential onboarding, email/password collection, a local companion, cross-account migrations, manual Google scope escalation, or automated deployment. Do not claim those work.

## Release gates

- CI pass, independent code/security review, callbacks/PKCE/replay checks, two real NestNyx users connecting at least two independent Google identities, and negative cross-owner tests (including forged connection IDs).
- Validate access-token refresh, concurrent refresh behavior, optional zero-trust job isolation, stale/revoked grants, and safe cleanup on timeout/killed worker.
- Verify `drive.file` semantics and Rclone lifecycle with real Google OAuth. Confirm quota/rate/size controls, monitoring and manual spend configuration.
- Register domain, privacy policy and branding, Google OAuth verification as required. Never request sensitive full-drive scopes without explicit review.
- Only after release approval, merge to production and deploy via approved manual workflow. No automatic enablement or migration of eight private operator remotes.
