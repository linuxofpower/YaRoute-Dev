# NestNyx production OAuth, repository configuration and distinct icons

Status: prepared in the DEV source for a reviewed production promotion. **No production Google OAuth client, Heroku app, secrets, or production repository was modified.**

## The three authorizations are different

1. **NestNyx MCP authentication**: ChatGPT logs in to the NestNyx MCP resource using the external OIDC/OAuth issuer (`NYX_OAUTH_ISSUER`, `NYX_OAUTH_AUDIENCE`, and JWKS). This protects `/mcp`; it does not grant Google Drive or MEGA access.
2. **Google Drive in NestNyx Rclone**: each user authorizes a *separate Google OAuth web client* (`NYX_GOOGLE_CLIENT_ID`, `NYX_GOOGLE_CLIENT_SECRET`) for `/connect/google/callback`. Do not copy ChatGPT's native Google connector credentials into Rclone.
3. **GitHub App OAuth**: separate `NYX_GITHUB_CLIENT_ID`, App ID and signing key; callback `/connect/github/callback`. Do not conflate this with Google or MCP OAuth.

## Google Cloud production project

- Keep the existing DevNestNyx Google Cloud project and consent-screen settings.
- Create a new **production** Google Cloud project in the Google Cloud Console, enable Google Drive API and open Google Auth Platform.
- Under Branding, choose **NestNyx** (not DevNestNyx) and the purple production logo. A 96x96 production PNG is already committed in the DEV reference source at `public/branding/nestnyx-prod.png`; Google normally recommends a square 120x120 PNG for its consent screen. Upload the appropriate resized image manually to the *production* Google Cloud project; committing artwork does not change Google branding.
- Under Audience, choose External for Google consumer accounts; start Testing for limited test users, and only publish when verification is ready.
- Under Data Access, request only implemented scopes. The DEV implementation currently requests `openid email https://www.googleapis.com/auth/drive.readonly`. **Google classifies drive.readonly as restricted**: a public multi-user app may need extensive verification and an independent security assessment. Consider narrowing to `drive.file` with explicit file selection before broad launch; this requires design and backend changes.
- Under Clients, create an OAuth web application named **NestNyx Production** and set the exact HTTPS authorized redirect URI:
  `https://ACTUAL-PRODUCTION-HOST/connect/google/callback`.
  Use the actual deployed Heroku hostname or verified custom domain, never the DEV hostname.
- Put the production client ID and client secret **only in production Heroku config vars / managed secret store**, not tracked GitHub files, PRs or ChatGPT messages.

## Runtime vars — production Heroku (private values)

- `NYX_PUBLIC_URL`: real production HTTPS **origin**, without /mcp.
- `NYX_SERVICE_NAME=NestNyx`, `NYX_BRAND_VARIANT=production`.
- `NYX_OAUTH_ISSUER`, `NYX_OAUTH_AUDIENCE` (production `/mcp`), `NYX_OAUTH_JWKS_URI` if needed, `NYX_OAUTH_SCOPES`, and `NYX_PRIVATE_OAUTH_SUBJECTS` for private deployment.
- `NYX_GOOGLE_CLIENT_ID`, `NYX_GOOGLE_CLIENT_SECRET` only when the multi-user Google OAuth handler is actually deployed and intentionally enabled.
- `DATABASE_URL`, `NYX_STORAGE_ENCRYPTION_KEY` require dedicated production resources. Never share DEV keys or database.
- `NYX_MULTIUSER_RCLONE_ENABLED=false` until real two-user isolation tests pass. Do not enable public tenant mode on the existing private operator application.
- Preserve existing legacy `RCLONE_CONFIG_B64`, `NYX_SHARED_ROOTS_JSON`, `RCLONE_CONFIG_PATH` and any valid private operator roots until the migration is verified.
- Google OAuth credentials alone do not make NestNyx production multi-user Rclone available. The approved runtime implementation must be deployed first.

## GitHub: what belongs in version control

- `config/heroku-public.json`: **non-secret** intended production hostname, audience, service and brand variant after the actual production hostname is confirmed.
- `app.json`: descriptions and non-secret defaults, but never OAuth tokens or secrets.
- Documentation: separate client/callback/issuer names, private vs public boundaries, rollback/test procedures.
- The DEV repository's `NYX_BRAND_VARIANT=development` selects its checked-in blue `nestnyx-dev.png`. After an approved production promotion with both icons, `NYX_BRAND_VARIANT=production` selects the **different purple** `nestnyx-prod.png` at the same `/branding/icon.png` endpoint; its favicon, manifest, MCP icon and ChatGPT panel use this endpoint. Production must actually ship the code and assets before this is visible.
- Google Cloud OAuth logo and ChatGPT custom plugin directory icon are **separately administered UI metadata**. Repository commits alone will not change them.

**Current inconsistency identified**: `yaMorozYaroslav/YaRoute/config/heroku-public.json` still contains the DEV URL and audience. It must be corrected by a separately reviewed production change using the verified real production host; do **not** treat those values as production-safe.

## Heroku from Android

The official supported administration surface is the mobile browser accessing the Heroku Dashboard. Dashboard > New > Create new app; app > Settings > Reveal Config Vars; app > Resources for dyno quantity/size (subject to tier and cost). An unofficial Android client may ask for extensive Heroku permissions; do not grant production API tokens for convenience. Updating config vars causes an app release/restart. Dynos are billed resources: get explicit owner confirmation for any scaling.

## MEGA two-factor authentication

Rclone's published MEGA backend now lists the optional `--mega-2fa` / `2fa` configuration option. **The current NestNyx custom enrollment form still has only email/password fields**, so it cannot complete a separate MEGA 2FA challenge. Users with 2FA should keep it enabled and use existing authorized access or wait for a verified ephemeral-code flow. Never paste one-time codes into ChatGPT, GitHub or Heroku config vars, and never store them as reusable credentials. Runtime session/2FA continuation also needs end-to-end verification before promising fully unattended access.
