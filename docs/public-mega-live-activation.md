# Isolated public MEGA + Google OAuth: activation checklist

**Current state:** Dev and Tester source with synthetic tests, not a publicly
verified installation. This document is an operator runbook, not approval to
create paid infrastructure or modify private Heroku apps.

## Important: do not reuse the private Heroku app template

- The repository's existing app.json requests RCLONE_CONFIG_B64 and
  NYX_SHARED_ROOTS_JSON. It is explicitly a PRIVATE Dev application template.
- The tracked config/heroku-public.json points to the existing private Dev
  Heroku origin; despite its filename, that is **not** a dedicated multi-user
  public tenant service.
- Never set NYX_DEPLOYMENT_MODE=public on an existing DevNestNyx/NestNyxPro
  app holding the operator's Rclone credentials. The startup isolation guard
  will correctly reject it.
- Use the same **NestNyx client/plugin experience and installed Rclone binary**,
  but a distinct public service runtime, encrypted vault and PostgreSQL
  tenancy. Public owner Rclone access must use only the separately authorized
  read-only private broker. Never share process-wide operator config.

## Step A — external identity issuer (not yet verified)

In the trusted OAuth issuer's administrative console:

1. Create/identify the exact **public** NestNyx OAuth application and API
   audience. Do not change a private Dev/Pro OAuth application's connection list.
2. Enable the Google social connection for the public application and verify
   the issuer maps **real Google OAuth sign-ins** into immutable subjects of
   the form google-oauth2|<numeric Google subject>.
3. Disable non-Google login choices for this *public application* where
   possible. The MEGA-only public backend independently denies non-Google
   JWT subjects. An email claim alone is not trusted.
4. Verify supported ChatGPT OAuth authorization-code/PKCE, DCR if used, scopes,
   refresh-token policies, exact callback URLs, and JWKS metadata. Never
   weaken signature/issuer/audience/expiry checks to make login work.
5. Record only the issuer's hostname, application settings status and
   redacted evidence. Do NOT put OAuth secrets or identity tokens into
   GitHub, ChatGPT messages, or build artifacts.

## Step B — budget-approved isolated pilot (not yet provisioned)

Before creating or changing an app, check the existing strict $5 Eco
budget, database pricing and any expected extra app/dyno usage. The
current connected tools do not provide write access to Heroku/Auth0.

The public pilot must have:

- A **new** HTTPS origin, distinct from both existing private apps.
- NYX_SERVICE_NAME=NestNyxPublicPilot
- NYX_DEPLOYMENT_MODE=public
- NYX_PUBLIC_CONNECTORS_ENABLED=true
- NYX_MULTIUSER_RCLONE_ENABLED=true
- NYX_PUBLIC_TENANT_MEGA_ONLY=true
- NYX_PUBLIC_URL=<new public pilot origin>
- NYX_OAUTH_ISSUER=<trusted issuer with Google social connection>
- NYX_OAUTH_AUDIENCE=<new public pilot origin>/mcp
- NYX_OAUTH_SCOPES=nyx.read,nyx.write
- NYX_OAUTH_ALGORITHMS=RS256
- DATABASE_URL=<new isolated PostgreSQL database>
- NYX_STORAGE_ENCRYPTION_KEY=<fresh random base64-encoded 32-byte key>

The two last values belong **only in private hosting secret configuration**.
Public pilot MUST NOT inherit RCLONE_CONFIG_B64, RCLONE_CONFIG_PATH,
any RCLONE_CONFIG_* credential, NYX_SHARED_ROOTS_JSON, legacy rclone.conf
files or the private owner allowlist.

Keep NYX_PRIVATE_OWNER_LINK_ENABLED=false and
NYX_PRIVATE_BROKER_CLIENT_ENABLED=false for first-pass tenant acceptance.

On the isolated service, before accepting requests, run the read-only,
redacted, **offline** preflight:

    node dist/runtime/public-mega-activation-preflight.js

A successful check returns CONFIG_PREPARED_LIVE_TESTS_REQUIRED. It is
deliberately NOT a live provider verification; no secret values are printed.
The command never deploys, writes config or contacts external services.

The Dev repository also includes an optional convenience wrapper in
scripts/nyx-public-mega-activation-preflight.mjs. Tester promotion intentionally
preserves its own scripts/ directory, so the authoritative runtime checker is
compiled from src/runtime/public-mega-activation-preflight.ts and included in
both Dev and Tester builds. Do not weaken Tester tests or copy arbitrary scripts
into its protected staging contract.

## Step C — real Google + MEGA acceptance (not yet done)

- On the public URL, verify /health reports the exact approved Tester
  commit and publicly discoverable MCP tools are tenant-only.
- Anonymous /mcp request -> 401; non-Google OAuth identity -> 403;
  invalid/expired JWT -> 401. A *real* Google sign-in succeeds.
- Google user A signs in, creates MEGA connection A, grants storage:list
  on one chosen root, enters MEGA credentials on the official NestNyx HTTPS
  enrollment form (and 2FA there if required), probes, activates, lists files.
- Different Google user B repeats with a **different** MEGA account/root.
  The two PostgreSQL owner IDs, encrypted credentials and authorized roots
  must remain distinct.
- A cannot list, activate, revoke or probe B's connection ID, or obtain
  B's files. B cannot do these operations to A. Neither can call legacy
  global rclone tools or select Google's Drive tenant enrollment in
  MEGA-only mode.
- Restart the public service with its isolated DB and key; verify that
  each user's own MEGA connection survives and that cross-tenant operations
  still fail. Check replay, root traversal and rate limits.
- Record non-secret evidence, real user acceptance and expected live
  Tester SHA before treating the public pilot as usable.

## Step D — owner's private legacy Rclone broker (separately gated)

The operator's current ChatGPT MCP subject has Google-social format,
but this does **not** prove the Google email of that specific account.
Before enabling private legacy access:

1. Verify the intended Google email through the separate signed Google
   OIDC identity-only owner-link flow, with exact subject, email_verified,
   audience, nonce, code challenge and one-use PostgreSQL state.
2. Bind that verified immutable Google subject to the independently
   verified MCP OAuth subject in the public owner's singleton record.
3. Configure the private broker and the public broker client on their
   **separate** runtimes, using a dedicated random key, exact origin
   restrictions and 1–20 read-only area aliases. Never copy the private
   rclone.conf to the public service.
4. Test owner roots/list through the broker, and deny a second authenticated
   Google user, forged delegation, altered audience, disallowed root,
   token replay and traversal. Provider credentials must never be returned.

Enable the private link/broker only after the tenant-only pilot completes
Step C. The Step B preflight intentionally rejects prematurely enabled
private broker flags.

## Release and rollback

- Dev and Tester changes can merge with validated CI and security evidence,
  without operator click-through.
- Protected production master needs explicit operator approval.
- Neither GitHub CI nor this preflight is permitted to create, deploy,
  alter, restart or wake paid Heroku resources.
- Rollback public tenant: disable public connector/MEGA flags on its
  **own** isolated service. Private legacy credentials remain unchanged.
- Rollback broker: disable each broker-specific flag on the respective
  service; the private broker endpoint then refuses requests.
