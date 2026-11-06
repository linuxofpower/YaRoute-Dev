# Existing NestNyx plugin — public Google login, per-user Drive and MEGA

**Status:** source-code opt-in; not a deployed live public service.
This deliberately EXCLUDES Google Photos.

## Required UX and authorization

1. Every user signs into the existing public NestNyx plugin with Google,
   through the trusted OAuth issuer. NestNyx verifies JWT signature/JWKS,
   issuer, audience, expiry and required MCP scopes. The issuer must issue a
   `google-oauth2|<numeric subject>` only after *real Google login*.
2. PostgreSQL uses `oauth:<verified MCP subject>` as the immutable owner.
   Individual user A and B receive independent connection records.
3. The user selects provider **MEGA** or **Google Drive**, optionally multiple
   connections of each type, up to the existing per-owner connection limit.
4. MEGA authorization uses a short-lived first-party HTTPS enrollment form
   supporting 2FA; secrets never enter ChatGPT prompts or GitHub.
5. Google Drive uses a separate Google consent flow with code+PKCE,
   one-use hashed PostgreSQL state, and `drive.readonly` scope. This
   second grant is for storage, not for the original NestNyx sign-in.
6. Each connection selects the authorized MEGA root or exact Drive folder
   ID, passes a read-only Rclone probe, then activates. Each request loads
   encrypted provider credentials from an owner+connection-bound vault.
7. Rclone runs with a separate private 0600 temporary configuration for
   one invocation. It never sees a shared operator `rclone.conf`.
   Initial public API grants `storage:list` only (up to 100 entries
   per request). No arbitrary Rclone commands, file copy, mutation, deletion,
   or bulk-export command is exposed by this public flow.

## New public mode (mutually exclusive with legacy MEGA-only mode)

```text
NYX_DEPLOYMENT_MODE=public
NYX_SERVICE_NAME=NestNyxPublicPilot
NYX_PUBLIC_CONNECTORS_ENABLED=true
NYX_MULTIUSER_RCLONE_ENABLED=true
NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED=true
NYX_PUBLIC_TENANT_MEGA_ONLY=false
NYX_PUBLIC_URL=<dedicated-public-https-origin>
NYX_OAUTH_ISSUER=<trusted-https-issuer-with-real-Google-social-login>
NYX_OAUTH_AUDIENCE=<dedicated-public-https-origin>/mcp
NYX_OAUTH_SCOPES=nyx.read,nyx.write
NYX_OAUTH_ALGORITHMS=RS256
DATABASE_URL=<separate-public-PostgreSQL-connection>
NYX_STORAGE_ENCRYPTION_KEY=<fresh-32-byte-base64-private-secret>
NYX_GOOGLE_CLIENT_ID=<OAuth-client-ID-for-public-Drive>
NYX_GOOGLE_CLIENT_SECRET=<private-OAuth-client-secret>
```

The Google OAuth storage client must register an exact authorized redirect
`<dedicated-public-https-origin>/connect/google/callback`. The issuer's
Google login client and the Google Drive storage grant may require separate
application registrations. Use only the approved public client's identities
and callbacks. Store all secrets in the dedicated hosting secret manager.

**Do not reuse the repository root `app.json` or the tracked private Dev
Heroku profile.** These are for the operator's private instance and still
require `RCLONE_CONFIG_B64` and shared-root settings.

Do not set either mode flag without the isolated public runtime. Do not enable
both flags; the provider guard and read-only preflight must reject this.

## Live activation must remain separate

1. Budget review: verify whether an extra Eco dyno, PostgreSQL service,
   and OAuth provider configuration fit the operator's existing strict
   hosting budget. Do not start or wake paid apps automatically.
2. Create a **new** public service URL/database/secret vault. Never copy
   existing private Rclone config or local Termux credentials.
3. Verify the Google login provider truly issues Google social identities
   to the ChatGPT client. Syntax of `google-oauth2|` alone does not prove
   the owner's Google email or a real provider session.
4. Run the read-only compiled checker inside the proposed public runtime:
   `node dist/runtime/public-mega-activation-preflight.js`.
   `CONFIG_PREPARED_LIVE_TESTS_REQUIRED` is NOT live acceptance.
5. Test anonymous MCP -> 401 and non-Google signed identity -> 403.
   Sign in as two real Google users with **different** MEGA and Google
   Drive accounts. Perform provider consent, selected-root read tests,
   activation, isolation checks, revocation and restart persistence.
6. Independently verify the operator's approved Google email/subject
   linkage and the separate private broker before offering the operator's
   legacy remotes through the public plugin. All other users must be denied
   these remotes and any raw credential inventory.
7. Dev/Tester CI-gated merges may run without operator approval. Only
   `yaMorozYaroslav/YaRoute:master` is operator approved.

**Capabilities:** Local Rclone may have broad provider API scopes and
unrestricted native operations if the operator's credentials authorize them.
Public MEGA and Drive initially have only backend-controlled read listings
inside selected roots. Full provider authorization does not by itself grant
public MCP file download, modification, mass-copy or deletion.
