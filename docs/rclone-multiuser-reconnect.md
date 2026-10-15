# Multiple-user Rclone reconnect — isolated DEV (2026-10-15)

**Status: DEV draft PR; not deployed. Feature flag defaults OFF.**
**Never delete or rotate the legacy operator config before independently verified rollback.**

## Two separate authorization planes

- **Native ChatGPT Google Drive:** Google consent managed by the ChatGPT connector. Users connect it inside ChatGPT. Tokens are never shared with Rclone.
- **NestNyx Google Drive & MEGA through Rclone:** JWT-authenticated NestNyx owner -> separate immutable connection ID -> explicit provider authorization -> selected Drive folder or MEGA root -> read-only Rclone probe -> manual activation.
- The same Rclone executable can serve multiple users; one global credential file **cannot** safely serve unrelated users.

## Implemented in DEV

- `TenantRcloneService`: independent, encrypted PostgreSQL V2 credential records keyed by owner and immutable connection ID. Pending and active credentials coexist through tests. Every Rclone invocation creates a private `0600` config under a unique `0700` directory; legacy config and inherited credentials are not used.
- Per-tenant MCP tools: list/create Google/MEGA connections, select read-only `storage:list`, choose exact Drive folder ID or MEGA root, begin provider authorization, test pending credentials, activate after verification. New storage tools register only when the isolated public feature flag is enabled.
- `TenantGoogleOAuthService`: read-only Drive OAuth2 authorization code + PKCE, one-use hashed state, encrypted temporary verifier, 10-minute expiration, Google account verification, offline refresh token and no token returned to browser or ChatGPT.
- `TenantMegaEnrollmentService`: expiring, owner-scoped HTTPS setup link and first-party form. Password is never sent via GPT, command arguments, or URLs. Server runs `rclone obscure -` via standard input before encryption. Successful MEGA read probe is required before verified provider grant; temporary failure cannot replace active credentials.
- `RcloneService` refuses all legacy commands in public connector mode, but now allows bootstrapping the isolated public runtime without loading `RCLONE_CONFIG_B64`. `SharedRootsService` similarly hides legacy private roots from public tenants.
- Old private mode and existing production settings remain unchanged. All new code is behind the `NYX_MULTIUSER_RCLONE_ENABLED=true` switch.

## Explicit user configuration required in an ISOLATED DEV Heroku environment

1. Create a Google Cloud OAuth web client for the DEV NestNyx host, enable Google Drive API and configure the **exact** HTTPS authorized callback: `https://YOUR-DEV-HOST/connect/google/callback`.
2. Finish Google OAuth consent-screen requirements for requested `openid`, `email`, and Drive `drive.readonly` scopes. If Google requires verification or test-user approval, complete that with Google before offering the connector to others.
3. Configure separate DEV secrets, not in GitHub files or ChatGPT: `NYX_GOOGLE_CLIENT_ID`, `NYX_GOOGLE_CLIENT_SECRET`, `NYX_STORAGE_ENCRYPTION_KEY` (fresh random 32-byte base64 key), `DATABASE_URL`, `NYX_PUBLIC_URL`, and JWT/OIDC secrets/settings already required by NestNyx.
4. Only in the **independent DEV** deployment set `NYX_DEPLOYMENT_MODE=public`, `NYX_PUBLIC_CONNECTORS_ENABLED=true` and `NYX_MULTIUSER_RCLONE_ENABLED=true`; never activate this feature on the existing private production service. Do not copy the production operator Rclone config.
5. Connect two test users separately. For each, create an owner-specific storage connection, explicitly select a folder/root, begin Google OAuth or open the secure MEGA login link, then run a read-only probe and activate.
6. Prove cross-tenant access is denied and refresh/restart/rollback work. Do not enable storage writes/moves/deletes until separate risk gates and user-specific approval have been implemented.

## Limitations / release gates

- Native ChatGPT Google Drive consent remains separate; the code cannot create or authorize users' native ChatGPT connector sessions.
- The new read-only storage path is not a general file-management API yet. Write access is **not implemented**, even if Google or Rclone remote could write elsewhere.
- The current MEGA browser enrollment does **not** implement an additional MEGA 2FA challenge. Do **not** disable 2FA to use NestNyx.
- User-visible storage provider cards in the existing GitHub-only NestNyx connection UI still require dedicated UI work; the new backend MCP tools provide the staged onboarding.
- Live provider acceptance, cross-tenant integration tests and independent deployment tests have **not** been performed. CI/unit passing is not proof of provider access.
- Each provider may enforce additional consent or OAuth verification requirements. `storage:list` grants must be provider-verified, user-enabled and root-bound. A successful generic root probe does not prove any write permission.

## Rollback

Disable `NYX_MULTIUSER_RCLONE_ENABLED` in DEV, or revert this draft PR. No legacy Rclone remote, `RCLONE_CONFIG_B64`, `NYX_SHARED_ROOTS_JSON`, production storage credential, or Head/Body/Footer file has been altered by this PR. No old credential is deleted by V2 staging.
