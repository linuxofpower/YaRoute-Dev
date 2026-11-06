# Existing NestNyx plugin: Google OAuth first, personal MEGA through Rclone

**Status:** Dev source-code release candidate; not live OAuth provider,
Heroku/public deployment, or provider acceptance evidence.

## User journey

1. User installs/opens the **existing NestNyx ChatGPT plugin** and signs in
   using **Google OAuth** through the configured trusted OAuth issuer.
2. NestNyx verifies the MCP bearer JWT (JWKS signature, exact issuer,
   audience, expiration and required scopes). In MEGA-only public mode, the
   trusted issuer's subject MUST be `google-oauth2|<decimal Google sub>`.
   All other identities are rejected **before** any MCP tool dispatch.
3. NestNyx uses `oauth:<verified subject>` as an immutable PostgreSQL
   tenant owner. It creates a PENDING **mega** connection only for that owner.
4. User selects their MEGA root and permissions (read-only `storage:list`),
   then receives a ten-minute, one-time HTTPS enrollment URL generated
   for that exact authenticated owner and connection.
5. User enters MEGA credentials and optional two-factor code **only** on
   the trusted NestNyx HTTPS form; never in ChatGPT or OAuth state.
6. The backend uses its **existing Rclone binary** and a fresh
   user/connection-specific temporary `rclone.conf` (0600), with sanitized
   environment and no shared process-wide operator remotes.
   Exact-root read verification must succeed before activation.
7. The encrypted MEGA credential is stored against both PostgreSQL
   `owner_id` and `connection_id`. Subsequent listing and revocation
   require the **same authenticated Google owner**, exact selected root,
   and active grant. A second Google user cannot read, probe, activate,
   list or revoke the first user's connection.

## Authentication requirements

- The `google-oauth2|` prefix is an issuer-side Auth0-style Google
  social-identity namespace, **not a standalone proof of email ownership**.
  It is trusted here only AFTER a correctly validated JWT from the
  operator-approved OAuth issuer. The issuer must configure the ChatGPT
  NestNyx application to authenticate through the Google social
  connection and prevent arbitrary issuance or substitution of subjects.
- Valid Google identity A and B are **distinct** PostgreSQL owners.
  The common Google login mechanism does not merge MEGA credentials.
- MEGA's username/password and 2FA are a **second provider-specific
  authorization**, not a replacement for Google login.
- The MEGA HTTPS completion path uses one-time state bound to the owner
  minted after OAuth; even pending states created before this restriction
  cannot complete with a non-Google owner.
- This policy takes effect in the public MEGA-only mode:
  `NYX_DEPLOYMENT_MODE=public`,
  `NYX_PUBLIC_CONNECTORS_ENABLED=true`,
  `NYX_MULTIUSER_RCLONE_ENABLED=true`,
  `NYX_PUBLIC_TENANT_MEGA_ONLY=true`.
  A new Google-login-required flag is intentionally **not** necessary,
  preventing an unsafe omitted second toggle.

## Owner's existing Rclone remains private

- The operator's old Google Drive and MEGA remotes stay on the **private**
  Rclone service, behind a separate private OAuth owner gate.
- The publicly installed plugin may expose a narrowly scoped, read-only
  owner broker only AFTER the owner's additional, independently verified
  Google identity link and broker configuration are active.
- Public tenant workers must never inherit the operator's `rclone.conf`,
  `RCLONE_CONFIG*`, `NYX_SHARED_ROOTS_JSON`, or operator provider tokens.
- **Same plugin interface and existing Rclone software** does NOT mean
  sharing the operator's Rclone config among public users.
  Public and private credential holders must remain separate runtimes.
- Direct Rclone access to a local Termux or Arch Linux machine is not
  provided by this server-side implementation.

## Operational prerequisites and manual live checks

1. Review exact Dev PR commit, CI, security audit and post-merge SHA.
2. Configure the trusted OAuth issuer's Google social connection for the
   public NestNyx client; verify real identity-provider token subjects.
3. Deploy an **isolated public runtime** with no legacy operator config,
   a separate PostgreSQL database and encryption key. Check cost first;
   do not modify a $5 Heroku Eco deployment without a deployment plan.
4. Verify unauthenticated request => 401 and non-Google signed login => 403
   before any MEGA tools. Verify two separate, real Google accounts
   sign in and yield distinct `owner_id` values.
5. Each user independently performs real MEGA enrollment, an exact-root
   read probe, activation, listing and revocation. Check cross-user
   connection IDs, roots and retry/replay denial.
6. Verify protected private owner link + private broker denies user B and
   allows only the operator's independently proven Google identity.
7. Record redacted CI, persistence, outage, restart, 2FA and isolation
   receipts before public rollout. Keep all provider credentials private.
8. Promote Dev and unprotected Tester after green, verified checks.
   Production `yaMorozYaroslav/YaRoute:master` stays human approved.

No server settings, OAuth-provider settings, cloud resource, provider account,
local Termux/Arch configuration or canonical NYX bundle is changed by
this GitHub code patch.
