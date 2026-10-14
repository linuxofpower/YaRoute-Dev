# Multiple-user Rclone reconnect — isolated staging (2026-10-14)

**Status: DEV implementation, default OFF; NOT a deployed or user-ready login flow.**
Never remove, rotate, re-encrypt, rewrite, or migrate the current operator `rclone.conf`,
`RCLONE_CONFIG_B64`, `RCLONE_CONFIG_PATH`, `NYX_SHARED_ROOTS_JSON`, or private MEGA routes
as a side effect of enabling development code.

## Two independent connection planes

- **Native ChatGPT Google Drive connector:** per-user ChatGPT authorization managed by ChatGPT.
  Its tokens are not Rclone credentials, and must never be copied into NestNyx.
- **NestNyx Rclone:** per-user OAuth identity -> immutable connection ID -> selected
  Google Drive folder or MEGA root -> independently verified provider grant ->
  user-selected capability -> operation-specific approval if needed.

One Rclone binary may serve many users. **Never** use one operator's shared
`rclone.conf` or remote names to select other users' accounts.

## Implementation staged in DEV

`TenantRcloneService` introduces a separate, opt-in PostgreSQL table
`nyx_rclone_tenant_credentials_v2` (keyed by authenticated owner and immutable
connection ID). AES-256-GCM with owner/connection/provider-bound AAD encrypts
provider credentials. Pending and active versions are held separately to allow
reconnection tests without replacing an already working connection.

- Default `NYX_MULTIUSER_RCLONE_ENABLED` is unset: **no tenant DB initialization**.
- If enabled, requires `NYX_DEPLOYMENT_MODE=public`,
  `NYX_PUBLIC_CONNECTORS_ENABLED=true`, a private database and
  `NYX_STORAGE_ENCRYPTION_KEY` (32 random bytes, canonical base64).
- Only verified JWT subject ownership may select a connection. User-selected
  capabilities, verified provider capabilities, typed resource grants and
  independent provider matching are all required for an active read probe.
- Runtime creates an exclusive, `0600` temporary config inside a `0700` folder,
  uses a single ephemeral `tenant` remote, runs **read-only** `lsf` with
  time and output limits, sanitizes the child environment, and deletes the config.
- Drive probes are bound to the **selected root_folder_id**. MEGA probes are
  restricted to the selected root path. No cross-user remote names or arbitrary
  shell commands are accepted.
- Profile staging, read probe, and activation are separate. A passed root list
  is **not** proof of write permission or of an OAuth provider grant.
- No new MCP or HTTP credential-upload endpoint is exposed. The internal
  staging method must only be called by a future trusted, verified provider
  authorization handler; never feed credentials via a chat tool.

## Required BEFORE a user can reconnect with NestNyx

1. Implement Google OAuth authorization-code + PKCE with state, nonce, redirect
   checks, per-user identity proof and server-side token refresh. Use a
   project-specific OAuth client ID; do not depend on rclone's retiring shared
   Google client ID. Keep all keys and tokens in the private vault.
2. Implement a secure MEGA credential entry/onboarding route with
   independently verified account identity and 2FA handling as applicable;
   do not ask for passwords or codes in ChatGPT messages.
3. Extend the production connection onboarding service and UI beyond today's
   GitHub-only connector. No storage grant is active merely because a remote is
   configured.
4. Perform live per-user smoke tests (user A Drive, user B Drive, A MEGA, B MEGA):
   valid authorization, reconnect, token refresh, root-bounded reads,
   denied cross-tenant reads, encrypted persistence and restart behavior.
5. Only after verified tests should an explicit migration/activation copy the
   selected accounts into V2, one at a time. Keep the previous operator config
   and routes intact until rollback and user acceptance are verified.
6. Add independent write/copy/move/delete authorization and confirmation gates
   **separately**. This stage implements read-only connectivity checks, not
   arbitrary storage execution or any background migration.

## Rollback

Disable `NYX_MULTIUSER_RCLONE_ENABLED`. Private legacy configurations, fixed
legacy slots and routes remain unchanged. Pending V2 rows are not automatically
promoted and no legacy file is ever deleted. Revocation, expired grants and
missing resource rules must fail closed.
