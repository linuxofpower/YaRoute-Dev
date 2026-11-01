# Opt-in NestNyx → Heroku read-only metadata bridge

Status: **Dev source candidate, OFF by default; not deployed or authorized.**

## Trust boundary

- NestNyx must **NEVER** receive a Heroku global CLI token or API key.
- Only an **independent** read-scoped Heroku broker may hold `HEROKU_READ_OAUTH_TOKEN` (scope `read`, not `global` or `read-protected`). The broker is separate from the Dev/Pro NestNyx process and from the multi-user Rclone deployment.
- The existing `broker/heroku-readonly.mjs` permits exactly two fixed Heroku GET operations: app metadata and releases. It authenticates HMAC requests, enforces a second exact owner/connection/app grant map, returns bounded allowlisted fields, rejects finance/config/log-drain/read-protected operations, and rate limits requests.
- Heroku warns that even OAuth `read` can expose some write credentials in metadata (e.g. log drains), so fixed endpoint/response filtering and broker isolation are essential.
- This bridge does **NOT** implement config values, config name enumeration, config mutation, deployment, restart, billing, add-ons, or raw logs. For config KEY NAMES only, use a local redacted CLI capture in Termux.

## Required manual setup before live use

1. Deploy the *independent* broker manually on a separately secured HTTPS host. Do not run it in the existing DevNestNyx multi-user runtime. Never put its Heroku OAuth token, HMAC key or grants JSON into Git, Google Drive, YaRoute Head/Body/Footer or chat.
2. In Heroku CLI on your own device, create a separate expiring authorization with `heroku authorizations:create --scope read --description 'NYX read-only broker' --expires-in 2592000`. Keep the output secret; store it in the independent broker secure environment only. Review/revoke it later from the Heroku account.
3. Provision broker settings `HEROKU_READ_OAUTH_TOKEN`, `NYX_HEROKU_BROKER_SHARED_KEY` (random 32+ characters), `NYX_HEROKU_BROKER_GRANTS_JSON` (only your authenticated owner, stable UUID and explicit app names), and the hosting platform `PORT`. Verify a signed authorized request succeeds and unauthenticated/unlisted requests fail.
4. On DevNestNyx **only**, provision `NYX_HEROKU_READ_ENABLED=true`, `NYX_HEROKU_READ_OWNER=oauth:<subject>`, `NYX_HEROKU_READ_CONNECTION_ID=<UUID>`, `NYX_HEROKU_READ_APPS=<comma-delimited exact app names>`, `NYX_HEROKU_BROKER_URL=https://<independent-broker-host>`, `NYX_HEROKU_BROKER_SHARED_KEY=<broker HMAC key>` (never the Heroku OAuth token). The owner, UUID and app list must agree with the broker's independent grants.
5. Redeploy reviewed Dev/Tester source through the established Dev → Tester → Dev Heroku path; reconnect plugin discovery. The new tools are `nyx_heroku_app_info` and `nyx_heroku_releases`. Both are read-only and require the authenticated OAuth subject.
6. Verify disabled-by-default state, wrong-owner/wrong-app denials, release metadata sanitization, broker outage behavior, HMAC replay window and no credentials in outputs. Turn the feature off if any check fails.

## Termux and Proton handling

- Heroku CLI for ARM/Termux: `pkg install nodejs-lts git age -y` then `npm install -g heroku`, browser `heroku login`. Heroku may keep its token in a local `.netrc` fallback; enforce mode 0600 and do not copy it into shared storage.
- Use the NYX Termux helper to capture only **non-secret** metadata and config key names. Encrypt any full configuration backup through `age -p` as an `.age` file before uploading to Proton Drive.
- Reusable passwords, recovery codes and API tokens belong in **Proton Pass** (with MFA), not in synced plaintext folders. Proton Drive receives only encrypted `.age` backups and non-secret inventories. Do not use the deprecated experimental Rclone Proton Drive backend as the sole secrets backup.

**Scope:** This is read-only Heroku visibility. It does not authorize changing Dev, protected master or Pro, nor any paid/financial operation.