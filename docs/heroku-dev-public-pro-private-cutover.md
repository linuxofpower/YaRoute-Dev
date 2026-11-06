# NestNyx two Heroku apps: Dev public, Pro private

Status: reviewed cutover contract. **No Heroku configuration has been changed**.

## Verified inventory

| App | Intended role | Neon database |
|---|---|---|
| dev-nest-nyx | Public Google OAuth, personal MEGA/Google Drive pilot | nestnyx-public / purple-queen-73979953 |
| nest-nyx-pro | Private canonical Nyx and owner Rclone | nestnyx-pro / soft-block-55234842 |

The new public Neon project is empty and its direct host is:
ep-falling-silence-b9rcrzay.c-7.eu-central-1.aws.neon.tech
A pooled Neon host has -pooler before .c-7. The former private Dev database
nestnyx-dev / square-cell-00318919 must be preserved for recovery.

Read-only connected plugin inventories show **eight** matching private remote
names on BOTH Heroku apps. This does not establish online provider readability.
Never remove Dev's legacy Rclone config until a safe Pro read-back of critical
Google Drive AND MEGA areas has been independently verified.

## Phase A: read-only inspection, Termux or Arch

    heroku --version
    heroku apps
    heroku apps:info --app dev-nest-nyx
    heroku apps:info --app nest-nyx-pro
    heroku ps --app dev-nest-nyx
    heroku ps --app nest-nyx-pro
    heroku addons --app dev-nest-nyx
    heroku addons --app nest-nyx-pro

From a checked-out Dev repository:

    node scripts/nyx-heroku-two-app-audit.mjs

This invokes only Heroku config and apps-info READ endpoints and outputs
booleans and non-secret flags. NEVER paste raw Heroku config or auth token
into ChatGPT, GitHub or a Termux command-output capture. The audit exits 2
before cutover by design. Heroku Eco dynos share a 1000-hour/month pool;
do not create another app or add-on, or wake sleeping dynos to inspect.

## Phase B: retain Pro FIRST

1. Verify Pro's private mode, owner allowlist, existing Neon Pro database,
   encryption key, global Rclone config and shared-root mapping.
2. Pro's eight remote names were inventoried; test read-only access to at
   least one required Google Drive root and one MEGA root in the real Pro
   runtime, without writes, bulk transfers or credential exposure.
3. Verify the intended Google account through the separate identity
   linking flow. An MCP Google social subject does NOT prove the email.
4. Preserve old Dev Neon state and a secure operator-only rollback method.

## Phase C: convert existing Dev, NOT a third Heroku app

Only after Phase B, point the EXISTING dev-nest-nyx app to the EMPTY Neon
public project with a NEW encryption key. Remove ALL private legacy Rclone
config variables, remote options, shared root mapping, owner allowlist and
any stale rclone.conf from Dev, not Pro. Public bootstrap refuses mixed
private/public credentials.

Expected PUBLIC Dev non-secret settings:

    NYX_DEPLOYMENT_MODE=public
    NYX_SERVICE_NAME=NestNyxPublicPilot
    NYX_PUBLIC_CONNECTORS_ENABLED=true
    NYX_MULTIUSER_RCLONE_ENABLED=true
    NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED=true
    NYX_PUBLIC_TENANT_MEGA_ONLY=false
    NYX_PRIVATE_OWNER_LINK_ENABLED=false
    NYX_PRIVATE_BROKER_CLIENT_ENABLED=false
    NYX_OAUTH_SCOPES=nyx.read,nyx.write
    NYX_OAUTH_ALGORITHMS=RS256
    NYX_PUBLIC_NEON_HOST=ep-falling-silence-b9rcrzay.c-7.eu-central-1.aws.neon.tech
    NYX_PRIVATE_PRO_URL=<actual Pro HTTPS origin from Heroku apps:info>

Other REQUIRED Dev values:
- NYX_PUBLIC_URL: EXISTING Dev HTTPS origin verified against Heroku app info
- NYX_OAUTH_ISSUER and NYX_OAUTH_AUDIENCE: verified public Google
  social-identity issuer and Dev /mcp resource audience
- NYX_GOOGLE_CLIENT_ID and protected NYX_GOOGLE_CLIENT_SECRET:
  second, Drive-specific Google OAuth client and exact callback URL
- DATABASE_URL: new public Neon database connection with sslmode=require
  matching the independently inventoried public endpoint DNS name
- NYX_STORAGE_ENCRYPTION_KEY: new 32-byte base64-encoded random key

Use Heroku protected Settings > Config Vars for passwords and API secrets.
Do not put credentials in CLI history, terminals captured by automation or
tracked app.json. The existing root app.json is for private Dev and requires
RCLONE_CONFIG_B64; do NOT use it as a public provisioning blueprint.
Heroku config changes restart the web dyno; perform an ordered maintenance
window cutover, never share private config with public requests.

## Phase D: acceptance gates

The compiled READ-ONLY preflight checks actual public Neon hostname,
TLS, Pro private URL, separate origin, feature flags and no global remotes.
A PASS means only CONFIG_PREPARED_LIVE_TESTS_REQUIRED, not deployment.

Verify both real Google accounts, each user's independent MEGA AND Drive
authorization, per-owner PostgreSQL records, encrypted credentials,
root-scoped Rclone reads, anonymous 401, non-Google 403, cross-tenant 403,
restart persistence and private Pro-only eight-remotes inventory.
Operator-only Pro broker access needs separate identity/email verification
before activation. Google Photos is excluded.

## Rollback

If public Dev verification fails, disable Dev public access and restore
the previous private settings only from secure operator-owned recovery
material; do not publish passwords. Leave Pro credentials and both older
Neon databases intact. No private/prod data mutations are authorized here.
