# Public NestNyx owner-only legacy broker V1

Status: feature OFF by default; code-only Dev candidate. No live deployment or publication.

Goal: NestNyx becomes publicly installable. All signed-in users add independent Google Drive, MEGA and GitHub connections stored in PostgreSQL with encrypted per-owner credentials. Only the separately verified operator Google identity, bound to one immutable MCP subject, may request private legacy rclone reads. Public app never inherits RCLONE_CONFIG_B64, RCLONE_CONFIG_PATH, RCLONE_CONFIG, or NYX_SHARED_ROOTS_JSON.

## Isolated public deployment settings

- NYX_DEPLOYMENT_MODE=public
- NYX_PUBLIC_CONNECTORS_ENABLED=true
- NYX_MULTIUSER_RCLONE_ENABLED=true
- NYX_PRIVATE_OWNER_LINK_ENABLED=true
- NYX_PRIVATE_BROKER_CLIENT_ENABLED=true
- NYX_PRIVATE_BROKER_URL: exact HTTPS origin of private Heroku service.
- NYX_PRIVATE_BROKER_SHARED_KEY_B64: separate random 32-byte key configured securely in both services.
- Existing approved Google-owner email, MCP subject, Google OAuth client ID/secret, issuer, public URL, PostgreSQL URL and vault key.
- NEVER provide any existing private Rclone configuration or secret in public runtime.

## Private legacy service settings

- NYX_DEPLOYMENT_MODE=private
- NYX_PRIVATE_BROKER_SERVER_ENABLED=true
- NYX_PRIVATE_BROKER_EXPECTED_PUBLIC_URL: exact isolated public HTTPS origin.
- NYX_PRIVATE_BROKER_SHARED_KEY_B64: matching HMAC key.
- NYX_PRIVATE_BROKER_GOOGLE_SUBJECT: immutable verified Google subject.
- NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT: exact linked OAuth subject.
- NYX_PRIVATE_OAUTH_SUBJECTS: exactly one distinct approved owner subject.
- NYX_PRIVATE_BROKER_ALLOWED_AREAS: 1-20 pre-approved legacy area aliases.
- NYX_OAUTH_ISSUER, NYX_PUBLIC_URL, DATABASE_URL.
- Existing private rclone credentials stay here. No public tenant storage runs here.

## Security contract

1. MCP always validates signed bearer token, issuer, audience and scopes before tools run.
2. Public owner-link database singleton verifies exact approved Google email, immutable subject and trusted MCP issuer/subject. Never trust caller-supplied email or identity fields.
3. Public client signs a 30-second HMAC delegation for roots/list. It binds exact public origin, private endpoint audience, two immutable identities, one-use random JTI and root/path. No credentials cross the bridge.
4. Private service verifies HMAC, expiry, issuer, audience, identities and exact area grant. PostgreSQL consumes the JTI once and limits to 20 requests/minute, across dynos.
5. Listing returns at most 100 sanitized entries under one approved root, with name, size and directory flag only. No writes, transfers, deletes, generic Rclone commands, provider tokens, hashes or raw config.

## Live acceptance (required before declaring ready)

- Dev CI, security audit, exact Tester SHA and full integration suite green.
- Verify public app has no legacy operator credentials or shared root configuration.
- Verify approved owner Google identity proof and MCP subject independently before enabling any gate.
- Approved owner obtains only allowlisted private roots. Two unrelated users can create their own Drive/MEGA grants; attempts to list, probe, revoke or link someone else's credential are denied.
- Anonymous /mcp gets 401. Wrong owner, issuer, audience, email, Google subject, expired delegation, replay, traversal, forgery and disallowed root all denied.
- Test restart, outage, concurrent replay, rate limiting, 0600 temp files, key rotation and rollback.
- Confirm cost before provisioning. Existing strict $5 Heroku Eco budget remains; no app, add-on, dyno, config or database was created by this patch.

Rollback: disable NYX_PRIVATE_BROKER_CLIENT_ENABLED publicly and NYX_PRIVATE_BROKER_SERVER_ENABLED privately. Private endpoint then returns 404, tenant encrypted connections and legacy credentials remain unchanged.
