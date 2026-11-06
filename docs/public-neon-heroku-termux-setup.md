# Public NestNyx: existing Neon Postgres + isolated Heroku app + Termux

Status: **operator runbook, NOT deployed**. Public Dev and Tester code supports
Google login followed by per-user MEGA and Google Drive via isolated Rclone.
Do not run any cloud write commands before confirming costs, existing
application ownership and separate credential boundaries.

## Reuse the existing Neon account, NOT the private NestNyx database identity

There is no technical requirement to buy a Heroku Postgres add-on.
NestNyx's Node `pg` pools use `DATABASE_URL` and can connect to Neon PostgreSQL.

Preferred: create a new EMPTY Neon project for the public tenant service inside
the existing Neon account (subject to plan quotas). A separate database within
an existing Neon project is an alternative if it has a distinct least-privilege
role and the role cannot access private tables. Avoid using the private
service's `DATABASE_URL`, DB owner role, encryption key, or table namespace.

CAUTION: **branching a Neon database copies the parent's schema AND data at
the branch point**. Do NOT create a child branch of the private credential
database and assume it is empty. Create an empty project/database or remove
all inherited sensitive data before using a separate branch. Distinct
credentials and access boundaries are still required.

Configure the public database's **pooled** Neon TLS connection URL in the
public Heroku app's protected `DATABASE_URL` config variable, not in
GitHub or an `app.json` checked into a public repo. Use the database's
**direct** connection for administrative migrations requiring session
semantics. Ensure `sslmode=require` (or stronger certificate verification)
and do not disable TLS. Let Neon supply the exact connection URL.

The public runtime must use its **own random**
`NYX_STORAGE_ENCRYPTION_KEY` (32 bytes, base64) and private HTTPS OAuth
client settings; no credentials or encryption keys may be reused from
DevNestNyx or NestNyxPro. This is critical even if both databases live
inside the same Neon account.

## Existing shared $5 Heroku Eco budget

Creating a dedicated app is distinct from buying another Heroku PostgreSQL
add-on. A dedicated Eco web dyno may use the existing shared Eco-hour pool,
but remaining Eco hours and app formation must be checked; a new resource or
plan could incur charges. This runbook does **not** authorize cloud
provisioning or waking sleeping private apps.

The root `app.json` in YaRoute-Dev belongs to the PRIVATE deployment.
It requires RCLONE_CONFIG_B64 and NYX_SHARED_ROOTS_JSON. Do not use it to
create or configure a public app. The public app must start without any
process-global operator Rclone credentials or private service configuration.

## Heroku CLI: safe read-only inventory from Arch or Termux

On Termux, Heroku's official CLI can be installed using Node.js/npm where
its prebuilt binaries are unsuitable for Android ARM. Installation may require
troubleshooting native packages; use the regular Linux host if so.

```bash
pkg update
pkg install nodejs-lts git
npm install -g heroku
heroku --version
heroku login
heroku apps
heroku apps:info --app dev-nest-nyx
heroku apps:info --app nest-nyx-pro
heroku ps --app dev-nest-nyx
heroku addons --app dev-nest-nyx
```

These commands do not deliberately query config secrets or wake HTTP dynos.
Do NOT run `heroku config`, `heroku config:get DATABASE_URL`, or
`heroku auth:token` in a captured session; those may expose secrets. Do
not upload Heroku authentication files or Neon credentials with Termux Rclone
capture scripts.

After **explicitly approving** the separate public app name, available Eco
budget and isolated Neon DB, create/configure a NEW app only; never run
`heroku config:set NYX_DEPLOYMENT_MODE=public` on private Dev or Pro.

The public app's NON-SECRET settings would be:

```text
NYX_DEPLOYMENT_MODE=public
NYX_SERVICE_NAME=NestNyxPublicPilot
NYX_PUBLIC_CONNECTORS_ENABLED=true
NYX_MULTIUSER_RCLONE_ENABLED=true
NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED=true
NYX_PUBLIC_TENANT_MEGA_ONLY=false
NYX_OAUTH_SCOPES=nyx.read,nyx.write
NYX_OAUTH_ALGORITHMS=RS256
```

The public service also requires the exact public HTTPS `NYX_PUBLIC_URL`,
`NYX_OAUTH_ISSUER`, `NYX_OAUTH_AUDIENCE`, Google storage OAuth
`NYX_GOOGLE_CLIENT_ID` / protected `NYX_GOOGLE_CLIENT_SECRET`,
and protected `DATABASE_URL` / `NYX_STORAGE_ENCRYPTION_KEY`.
Never paste credentials into chat. Use Heroku Settings > Config Vars, or
another approved protected secret-entry method; setting secrets as command
line arguments risks process-list or terminal history exposure.

## Termux: local Rclone stays yours

```bash
command -v rclone
rclone version
rclone config file
rclone listremotes
```

These commands prove the local Rclone installation/configuration and list
only remote *names*, not provider permission scopes or remote ownership.
Never upload `~/.config/rclone/rclone.conf` to the public Heroku dyno.
The public NestNyx Rclone worker should produce one temporary 0600 config
per user/connection operation, load encrypted credentials only from the
public Neon database, and discard that temporary config after each call.

## Acceptance checklist

1. In Neon, confirm the PUBLIC database/role is empty and disjoint from private
   tables and credentials; record only nonsecret project/branch/database IDs.
2. Confirm dedicated public HTTPS app identity, exact running release SHA and
   database TLS connection; audit flags without exposing their secret values.
3. Run the compiled read-only activation check. Even
   CONFIG_PREPARED_LIVE_TESTS_REQUIRED is NOT proof of deployment.
4. Real Google user A enrolls independent MEGA and Drive accounts. User B
   independently enrolls distinct accounts. Each account grants
   `storage:list` only on selected exact root/folder; prove A/B isolation.
5. Check anonymous 401, signed non-Google 403, cross-user ownership denial,
   activation/revocation, restart persistence, Rclone root confinement,
   delegated private broker denial and safe fallback.
6. The operator's private legacy Rclone broker remains disabled until the
   owner's real Google identity has been independently verified and linked.
7. Only a protected production master merge needs operator approval; do not
   assume a green Tester source branch means a public app is deployed.

No Neon/Heroku resources, database records, OAuth-provider configuration,
Termux files or private credentials are modified by this documentation.
